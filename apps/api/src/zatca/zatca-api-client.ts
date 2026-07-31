import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ZATCA Reporting/Clearance API client (Detailed Technical Guideline §4) —
 * D-057, request/response shapes corrected against a real primary source in
 * D-059. Configured entirely via `ZATCA_API_BASE`; with it unset, every call
 * returns `{ outcome: 'not_configured' }` rather than throwing — the same
 * "don't pretend to have submitted" contract `ZatcaService.submit()` already
 * had before this existed (D-029).
 *
 * **Endpoint paths, request body, and response body are now confirmed**,
 * not reconstructed from memory — "User Manual — Developer Portal Manual
 * Version 3" §4.2.4 prints the literal FAQ answers, verbatim:
 * - `POST /invoices/reporting/single` and `POST /invoices/clearance/single`.
 * - Request body: exactly two fields, `{ invoiceHash, invoice }` — no `uuid`.
 *   (An earlier version of this client sent `uuid` too; ZATCA's own example
 *   body doesn't have it, so it's no longer sent.)
 * - Response body: a **flat** object, `{ invoiceHash, status, warnings,
 *   errors }` — not the nested `validationResults.{status,warningMessages,
 *   errorMessages}` shape this client originally guessed. `warnings`/`errors`
 *   are `null` on a clean pass, not empty arrays.
 * - HTTP status meanings per the same FAQ: 200 OK, 202 "accepted with
 *   warnings" (still a success), 303 when the wrong endpoint was used for the
 *   document's type (Standard via Reporting while Clearance is enabled, or
 *   vice versa) — Node's `fetch` follows 303 by default and would silently
 *   convert the POST into a GET against `Location`, so redirects are left
 *   unfollowed and detected via `res.redirected` instead of chasing that GET.
 *   400 Bad Request, 500 Internal Server Error.
 */

export interface ZatcaValidationMessage {
  code?: string;
  category?: string;
  message: string;
}

export type ZatcaSubmissionOutcome =
  | 'valid'
  | 'warnings'
  | 'rejected'
  | 'wrong_endpoint'
  | 'not_configured'
  | 'network_error';

export interface ZatcaSubmissionResult {
  outcome: ZatcaSubmissionOutcome;
  httpStatus?: number;
  warnings: ZatcaValidationMessage[];
  errors: ZatcaValidationMessage[];
  /** Full response body, kept for audit/debugging regardless of how parsing went. */
  raw?: unknown;
}

export interface ZatcaSubmissionRequest {
  /** base64 SHA-256 of the canonical (pre-signature) invoice — Section 5 Step 1. */
  invoiceHash: string;
  /** base64 of the full signed invoice XML. */
  invoiceXmlBase64: string;
}

interface ZatcaCredentials {
  /** The device's CSID (used as the Basic auth username). */
  csid: string;
  /** The CSID's secret (used as the Basic auth password). */
  secret: string;
}

/**
 * Auth for onboarding calls: an OTP alone (the very first Compliance CSID
 * request, before any CSID exists), a CSID+secret alone (compliance checks,
 * requesting a Production CSID), or both together (renewal — proves current
 * credential possession *and* fresh human authorization at once, D-059).
 */
export interface ZatcaOnboardingAuth {
  otp?: string;
  csid?: string;
  secret?: string;
}

@Injectable()
export class ZatcaApiClient {
  private readonly logger = new Logger(ZatcaApiClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('ZATCA_API_BASE');
  }

  reportInvoice(credentials: ZatcaCredentials, request: ZatcaSubmissionRequest): Promise<ZatcaSubmissionResult> {
    return this.submit('/invoices/reporting/single', credentials, request);
  }

  clearInvoice(credentials: ZatcaCredentials, request: ZatcaSubmissionRequest): Promise<ZatcaSubmissionResult> {
    return this.submit('/invoices/clearance/single', credentials, request);
  }

  /** Compliance/onboarding API calls (§3.3.3–3.3.4) share the same host but a different path and auth shape per step — see {@link ZatcaOnboardingAuth}. */
  async complianceRequest<T>(path: string, body: unknown, auth: ZatcaOnboardingAuth): Promise<T> {
    const base = this.config.get<string>('ZATCA_API_BASE');
    if (!base) {
      // A clean, catchable 400 rather than letting getOrThrow's bare Error
      // surface as an opaque 500 — onboarding is routinely attempted before
      // ZATCA_API_BASE is configured (D-058), so this is an expected,
      // user-facing condition, not a server fault (D-020's "degrades, does
      // not crash" contract, applied to onboarding rather than billing).
      throw new BadRequestException('ZATCA is not configured (ZATCA_API_BASE is unset) — onboarding cannot proceed');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept-Version': 'V2' };
    if (auth.csid && auth.secret) headers.Authorization = this.basicAuth(auth.csid, auth.secret);
    if (auth.otp) headers.OTP = auth.otp;

    const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as T;
    if (!res.ok) {
      throw new Error(`ZATCA ${path} failed (${res.status}): ${JSON.stringify(json)}`);
    }
    return json;
  }

  private basicAuth(username: string, password: string): string {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  private async submit(
    path: string,
    credentials: ZatcaCredentials,
    request: ZatcaSubmissionRequest,
  ): Promise<ZatcaSubmissionResult> {
    const base = this.config.get<string>('ZATCA_API_BASE');
    if (!base) {
      return { outcome: 'not_configured', warnings: [], errors: [] };
    }

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Version': 'V2',
          'Accept-Language': 'en',
          Authorization: this.basicAuth(credentials.csid, credentials.secret),
        },
        body: JSON.stringify({ invoiceHash: request.invoiceHash, invoice: request.invoiceXmlBase64 }),
      });
    } catch (err) {
      this.logger.error(`ZATCA ${path} request failed: ${(err as Error).message}`);
      return { outcome: 'network_error', warnings: [], errors: [{ message: (err as Error).message }] };
    }

    if (res.status === 303 || res.type === 'opaqueredirect') {
      this.logger.warn(`ZATCA ${path} returned a redirect (303) — wrong endpoint for this document's type`);
      return { outcome: 'wrong_endpoint', httpStatus: 303, warnings: [], errors: [] };
    }

    const body: unknown = await res.json().catch(() => null);
    return this.parseResponse(res.status, body);
  }

  private parseResponse(httpStatus: number, body: unknown): ZatcaSubmissionResult {
    const parsed = (body ?? {}) as {
      status?: string;
      warnings?: ZatcaValidationMessage[] | null;
      errors?: ZatcaValidationMessage[] | null;
    };

    const warnings = parsed.warnings ?? [];
    const errors = parsed.errors ?? [];

    let outcome: ZatcaSubmissionOutcome;
    if (httpStatus >= 400 || errors.length > 0) {
      outcome = 'rejected';
    } else if (warnings.length > 0 || httpStatus === 202) {
      outcome = 'warnings';
    } else {
      outcome = 'valid';
    }

    return { outcome, httpStatus, warnings, errors, raw: body };
  }
}
