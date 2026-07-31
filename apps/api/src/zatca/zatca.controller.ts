import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { RequestComplianceCsidDto } from './dto/zatca-onboarding.dto';
import { ZatcaOnboardingService } from './zatca-onboarding.service';
import { ZatcaService } from './zatca.service';

@Controller('zatca')
export class ZatcaController {
  constructor(
    private readonly zatca: ZatcaService,
    private readonly onboarding: ZatcaOnboardingService,
  ) {}

  /** Issue (or return the already-issued) compliant document for an invoice. */
  @Post('invoices/:id/issue')
  @RequirePermissions('process_payments')
  issue(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.zatca.issue(id, principal.sub);
  }

  @Post('invoices/:id/submit')
  @RequirePermissions('process_payments')
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.zatca.submit(id);
  }

  /** Compliance self-check — hash chain integrity and ICV continuity. */
  @Get('compliance')
  @RequirePermissions('view_dashboard')
  compliance(@CurrentUser() principal: AccessTokenPayload) {
    return this.zatca.verifyChain(principal.orgId!);
  }

  // ── Onboarding (D-058) — org-wide compliance settings, hq_admin only ──

  @Get('onboarding/status')
  @RequirePermissions('manage_organization')
  onboardingStatus(@CurrentUser() principal: AccessTokenPayload) {
    return this.onboarding.status(principal.orgId!);
  }

  @Post('onboarding/compliance-csid')
  @RequirePermissions('manage_organization')
  requestComplianceCsid(@CurrentUser() principal: AccessTokenPayload, @Body() dto: RequestComplianceCsidDto) {
    const { otp, ...csrFields } = dto;
    return this.onboarding.requestComplianceCsid(principal.orgId!, otp, csrFields, principal.sub);
  }

  @Post('onboarding/compliance-checks')
  @RequirePermissions('manage_organization')
  runComplianceChecks(@CurrentUser() principal: AccessTokenPayload) {
    return this.onboarding.runComplianceChecks(principal.orgId!);
  }

  @Post('onboarding/production-csid')
  @RequirePermissions('manage_organization')
  requestProductionCsid(@CurrentUser() principal: AccessTokenPayload) {
    return this.onboarding.requestProductionCsid(principal.orgId!, principal.sub);
  }

  @Post('onboarding/renew')
  @RequirePermissions('manage_organization')
  renewProductionCsid(@CurrentUser() principal: AccessTokenPayload, @Body() dto: RequestComplianceCsidDto) {
    const { otp, ...csrFields } = dto;
    return this.onboarding.renewProductionCsid(principal.orgId!, otp, csrFields, principal.sub);
  }

  @Post('onboarding/revoke')
  @RequirePermissions('manage_organization')
  revoke(@CurrentUser() principal: AccessTokenPayload) {
    return this.onboarding.revokeLocally(principal.orgId!, principal.sub);
  }
}
