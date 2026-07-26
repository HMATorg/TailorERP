import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Atomic document numbering (D-038).
 *
 * `count(*) + 1` looks fine until two tills check out at once: both read the
 * same count, both write the same number, and the unique constraint turns the
 * loser into a 500. Concurrency testing found exactly that — 11 of 12 parallel
 * checkouts failed.
 *
 * `INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value` is a
 * single atomic statement: the row lock serialises callers, so every caller
 * gets a distinct number and nobody sees a conflict.
 */
@Injectable()
export class CounterService {
  /**
   * Reserves the next number in a sequence. Must run inside the caller's
   * transaction so the number is rolled back with the rest of the work.
   */
  async next(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      /** null for org-wide sequences (invoice numbers) */
      storeId?: string | null;
      kind: 'order' | 'invoice' | 'ticket';
      /** e.g. the year, so invoice numbering restarts annually */
      scope?: string;
    },
  ): Promise<number> {
    const scope = params.scope ?? '';
    // storeId is nullable and NULL never equals NULL, so the unique index
    // cannot match on it — a sentinel UUID keeps ON CONFLICT working for
    // org-wide sequences.
    const storeKey = params.storeId ?? '00000000-0000-0000-0000-000000000000';

    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO document_counters (organization_id, store_id, kind, scope, value, updated_at)
      VALUES (${params.organizationId}::uuid, ${storeKey}::uuid, ${params.kind}, ${scope}, 1, NOW())
      ON CONFLICT (organization_id, store_id, kind, scope)
      DO UPDATE SET value = document_counters.value + 1, updated_at = NOW()
      RETURNING value
    `;
    return rows[0].value;
  }

  /**
   * Seeds a counter from existing rows so numbering continues rather than
   * restarting at 1 on an installation that already has data.
   */
  async seedFrom(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      storeId?: string | null;
      kind: 'order' | 'invoice' | 'ticket';
      scope?: string;
      currentMax: number;
    },
  ): Promise<void> {
    const scope = params.scope ?? '';
    const storeKey = params.storeId ?? '00000000-0000-0000-0000-000000000000';
    await tx.$executeRaw`
      INSERT INTO document_counters (organization_id, store_id, kind, scope, value, updated_at)
      VALUES (${params.organizationId}::uuid, ${storeKey}::uuid, ${params.kind}, ${scope}, ${params.currentMax}, NOW())
      ON CONFLICT (organization_id, store_id, kind, scope)
      DO UPDATE SET value = GREATEST(document_counters.value, ${params.currentMax})
    `;
  }
}
