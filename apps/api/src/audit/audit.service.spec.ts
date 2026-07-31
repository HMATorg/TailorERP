import 'reflect-metadata';
import { AuditService } from './audit.service';

/**
 * AuditService (D-060) — the append-only trail every platform-admin action
 * relies on, previously exercised only indirectly through other services'
 * tests and e2e. The one behavior worth locking in explicitly: "failures are
 * logged but never break the business operation" (module doc comment) — a
 * caller must never see log() throw, since an audit-write hiccup must not
 * take down the mutation it was recording.
 */
function build() {
  const prisma = { auditLog: { create: jest.fn() } };
  const service = new AuditService(prisma as never);
  return { service, prisma };
}

describe('AuditService', () => {
  it('writes all provided fields, defaulting actorType to staff', async () => {
    const { service, prisma } = build();
    prisma.auditLog.create.mockResolvedValue({});

    await service.log({
      organizationId: 'org-1',
      storeId: 'store-1',
      actorUserId: 'user-1',
      action: 'platform.organization_created',
      entityType: 'organization',
      entityId: 'org-1',
      oldValue: { status: 'active' },
      newValue: { status: 'suspended' },
      ip: '127.0.0.1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        storeId: 'store-1',
        actorUserId: 'user-1',
        actorType: 'staff',
        action: 'platform.organization_created',
        entityType: 'organization',
        entityId: 'org-1',
        oldValue: { status: 'active' },
        newValue: { status: 'suspended' },
        ip: '127.0.0.1',
      },
    });
  });

  it('honours an explicit actorType instead of the default', async () => {
    const { service, prisma } = build();
    prisma.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'platform.impersonation_started', actorType: 'impersonation' });
    expect(prisma.auditLog.create.mock.calls[0][0].data.actorType).toBe('impersonation');
  });

  it('never throws when the write fails — the caller must not see it', async () => {
    const { service, prisma } = build();
    prisma.auditLog.create.mockRejectedValue(new Error('connection reset'));
    await expect(service.log({ action: 'anything' })).resolves.toBeUndefined();
  });

  it('omits undefined optional fields rather than writing literal undefined', async () => {
    const { service, prisma } = build();
    prisma.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'platform.plan_upserted' });
    const { data } = prisma.auditLog.create.mock.calls[0][0];
    expect(data.organizationId).toBeUndefined();
    expect(data.actorType).toBe('staff');
    expect(data.action).toBe('platform.plan_upserted');
  });
});
