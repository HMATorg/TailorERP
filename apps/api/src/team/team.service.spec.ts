import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { TeamService } from './team.service';

/**
 * TeamService.invite() branches on dto.password (D-063): with it set, no
 * Invitation row is ever created and no email is sent — the user is created
 * active immediately via createDirectly(). The one behavior worth locking in
 * hardest: every guard that already ran for the email-invite path (HQ grant
 * check, store-in-org check, duplicate-email, seat limit) must still run
 * before the branch, since createDirectly() itself trusts its caller.
 */
function build() {
  const prisma: Record<string, any> = {
    user: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    store: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Al Anwar Tailors' }) },
    organizationSubscription: { findUnique: jest.fn() },
    invitation: { create: jest.fn() },
    userStoreRole: { createMany: jest.fn() },
  };
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
  const config = { get: jest.fn().mockReturnValue('development') };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const mailer = { send: jest.fn().mockResolvedValue(undefined) };
  const featureGate = { assertFeature: jest.fn().mockResolvedValue(undefined) };
  const service = new TeamService(prisma as never, config as never, audit as never, mailer as never, featureGate as never);
  return { service, prisma, config, audit, mailer, featureGate };
}

const assignment = { storeId: 'store-1', role: 'cashier' as const };

describe('TeamService.invite — password branch (D-063)', () => {
  it('creates the user directly, active, with no Invitation row and no email sent', async () => {
    const { service, prisma, audit, mailer } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationSubscription.findUnique.mockResolvedValue(null);
    prisma.store.count.mockResolvedValue(1);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'hire@alanwar.example',
      fullName: 'Direct Hire',
    });

    const result = await service.invite(
      'org-1',
      'actor-1',
      {
        email: 'hire@alanwar.example',
        fullName: 'Direct Hire',
        password: 'a-strong-password',
        assignments: [assignment],
      } as never,
    );

    expect(result).toEqual({
      id: 'user-1',
      email: 'hire@alanwar.example',
      fullName: 'Direct Hire',
      createdDirectly: true,
    });
    expect(prisma.invitation.create).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'hire@alanwar.example', organizationId: 'org-1' }),
      }),
    );
    expect(prisma.userStoreRole.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'user-1', storeId: 'store-1', role: 'cashier' })],
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.user_created_directly', entityId: 'user-1' }),
    );
  });

  it('hashes the password before persisting — never stores it in plaintext', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationSubscription.findUnique.mockResolvedValue(null);
    prisma.store.count.mockResolvedValue(1);
    prisma.user.create.mockResolvedValue({ id: 'user-1', email: 'hire@alanwar.example', fullName: null });

    await service.invite(
      'org-1',
      'actor-1',
      { email: 'hire@alanwar.example', password: 'a-strong-password', assignments: [assignment] } as never,
    );

    const written = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
    expect(written.passwordHash).toBeDefined();
    expect(written.passwordHash).not.toBe('a-strong-password');
    expect(written).not.toHaveProperty('password');
  });

  it('still enforces the HQ-grant guard before creating the user directly', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ orgRole: null }); // actor is not an hq_admin
    
    await expect(
      service.invite(
        'org-1',
        'actor-1',
        { email: 'hire@alanwar.example', password: 'a-strong-password', asHqAdmin: true } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('still rejects a duplicate email before creating the user directly', async () => {
    const { service, prisma } = build();
    prisma.store.count.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.invite(
        'org-1',
        'actor-1',
        { email: 'hire@alanwar.example', password: 'a-strong-password', assignments: [assignment] } as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('still enforces the plan seat limit before creating the user directly', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationSubscription.findUnique.mockResolvedValue({ plan: { maxUsers: 1, name: 'Basic' } });
    prisma.user.count.mockResolvedValue(1);
    
    await expect(
      service.invite(
        'org-1',
        'actor-1',
        { email: 'hire@alanwar.example', password: 'a-strong-password', assignments: [assignment] } as never,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('still requires assignments or asHqAdmin before creating the user directly', async () => {
    const { service, prisma } = build();
    
    await expect(
      service.invite('org-1', 'actor-1', { email: 'hire@alanwar.example', password: 'a-strong-password' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates an hq_admin with no store assignments when asHqAdmin is set', async () => {
    const { service, prisma } = build();
    // First call is the actor-can-grant-hq lookup (by actorId); second is the duplicate-email check.
    prisma.user.findUnique.mockResolvedValueOnce({ orgRole: 'hq_admin' }).mockResolvedValueOnce(null);
    prisma.organizationSubscription.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-2', email: 'hq@alanwar.example', fullName: null });

    await service.invite('org-1', 'actor-1', { email: 'hq@alanwar.example', password: 'a-strong-password', asHqAdmin: true } as never);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgRole: 'hq_admin' }) }),
    );
    expect(prisma.userStoreRole.createMany).not.toHaveBeenCalled();
  });
});

describe('TeamService.invite — email-invite branch is unaffected when password is omitted', () => {
  it('creates an Invitation row and sends an email, not a User row', async () => {
    const { service, prisma, mailer } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationSubscription.findUnique.mockResolvedValue(null);
    prisma.store.count.mockResolvedValue(1);
    prisma.invitation.create.mockResolvedValue({
      id: 'invite-1',
      email: 'invitee@alanwar.example',
      expiresAt: new Date('2026-01-01'),
    });
    
    const result = await service.invite(
      'org-1',
      'actor-1',
      { email: 'invitee@alanwar.example', assignments: [assignment] } as never,
    );

    expect(prisma.invitation.create).toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(mailer.send).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'invite-1', email: 'invitee@alanwar.example' });
    expect(result).not.toHaveProperty('createdDirectly');
  });
});
