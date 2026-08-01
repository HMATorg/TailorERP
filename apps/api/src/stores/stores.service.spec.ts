import 'reflect-metadata';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';
import type { AccessTokenPayload } from '../auth/auth.types';

/**
 * StoresService — including the WhatsApp config write path added in D-062.
 * The one behavior worth locking in hardest: the encrypted token blob must
 * never come back out of any read/write path, and the plaintext token must
 * never be persisted as-is — both are exactly the kind of thing that looks
 * fine in a quick manual check and only shows up as a leak in review.
 */
function build() {
  const prisma = {
    user: { findUnique: jest.fn() },
    store: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    organizationSubscription: { findUnique: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const config = { getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)) };
  const service = new StoresService(prisma as never, audit as never, config as never);
  return { service, prisma, audit, config };
}

const rawStore = (overrides: Record<string, unknown> = {}) => ({
  id: 'store-1',
  organizationId: 'org-1',
  name: 'Riyadh HQ',
  address: null,
  phone: null,
  email: null,
  isHeadquarters: true,
  status: 'active',
  timezone: null,
  operatingHours: {},
  whatsappPhoneNumberId: null,
  whatsappAccessTokenEncrypted: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('StoresService', () => {
  describe('read paths never leak the encrypted WhatsApp token', () => {
    it('listAccessible strips it and derives whatsappConfigured for an hq_admin', async () => {
      const { service, prisma } = build();
      const principal = { typ: 'staff', orgId: 'org-1', sub: 'user-1' } as AccessTokenPayload;
      prisma.user.findUnique.mockResolvedValue({ isActive: true, orgRole: 'hq_admin', storeRoles: [] });
      prisma.store.findMany.mockResolvedValue([
        rawStore({ whatsappAccessTokenEncrypted: 'iv:tag:ciphertext' }),
      ]);

      const [row] = await service.listAccessible(principal);

      expect(row).not.toHaveProperty('whatsappAccessTokenEncrypted');
      expect(row.whatsappConfigured).toBe(true);
    });

    it('listAccessible reports whatsappConfigured:false when no token is on file', async () => {
      const { service, prisma } = build();
      const principal = { typ: 'staff', orgId: 'org-1', sub: 'user-1' } as AccessTokenPayload;
      prisma.user.findUnique.mockResolvedValue({ isActive: true, orgRole: 'hq_admin', storeRoles: [] });
      prisma.store.findMany.mockResolvedValue([rawStore()]);

      const [row] = await service.listAccessible(principal);
      expect(row.whatsappConfigured).toBe(false);
    });

    it('rejects a non-staff or org-less principal', async () => {
      const { service } = build();
      await expect(
        service.listAccessible({ typ: 'customer' } as AccessTokenPayload),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('getById strips the encrypted token too', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue(
        rawStore({ whatsappAccessTokenEncrypted: 'iv:tag:ciphertext' }),
      );
      const result = await service.getById('org-1', 'store-1');
      expect(result).not.toHaveProperty('whatsappAccessTokenEncrypted');
      expect(result.whatsappConfigured).toBe(true);
    });

    it('getById throws when the store does not belong to this org', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue(null);
      await expect(service.getById('org-1', 'store-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('enforces the plan store limit with 402 before creating', async () => {
      const { service, prisma } = build();
      prisma.organizationSubscription.findUnique.mockResolvedValue({
        plan: { maxStores: 1, name: 'Basic' },
      });
      prisma.store.count.mockResolvedValue(1);
      await expect(
        service.create('org-1', 'actor-1', { name: 'New Branch' } as never),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.store.create).not.toHaveBeenCalled();
    });

    it('creates and audits, sanitizing the response', async () => {
      const { service, prisma, audit } = build();
      prisma.organizationSubscription.findUnique.mockResolvedValue(null); // no subscription = no limit check
      prisma.store.create.mockResolvedValue(rawStore({ name: 'New Branch' }));

      const result = await service.create('org-1', 'actor-1', { name: 'New Branch' } as never, '127.0.0.1');

      expect(result).not.toHaveProperty('whatsappAccessTokenEncrypted');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'store.created', organizationId: 'org-1' }),
      );
    });
  });

  describe('update — WhatsApp config write path', () => {
    it('encrypts the plaintext token before persisting and never returns it', async () => {
      const { service, prisma, config } = build();
      prisma.store.findFirst.mockResolvedValue(rawStore());
      prisma.store.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(rawStore({ ...data })),
      );

      const result = await service.update(
        'org-1',
        'actor-1',
        'store-1',
        { whatsappAccessToken: 'EAA_plaintext_secret', whatsappPhoneNumberId: '123456' } as never,
      );

      const written = prisma.store.update.mock.calls[0][0].data;
      expect(written.whatsappAccessTokenEncrypted).toBeDefined();
      expect(written.whatsappAccessTokenEncrypted).not.toContain('EAA_plaintext_secret');
      expect(written.whatsappPhoneNumberId).toBe('123456');
      expect(config.getOrThrow).toHaveBeenCalledWith('TOKEN_ENCRYPTION_KEY');
      expect(result).not.toHaveProperty('whatsappAccessTokenEncrypted');
      expect(JSON.stringify(result)).not.toContain('EAA_plaintext_secret');
    });

    it('leaves the stored token untouched when whatsappAccessToken is omitted', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue(rawStore());
      prisma.store.update.mockResolvedValue(rawStore({ name: 'Renamed' }));

      await service.update('org-1', 'actor-1', 'store-1', { name: 'Renamed' } as never);

      const written = prisma.store.update.mock.calls[0][0].data;
      expect(written).not.toHaveProperty('whatsappAccessTokenEncrypted');
    });

    it('updates the phone number id independently of the token', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue(rawStore());
      prisma.store.update.mockResolvedValue(rawStore({ whatsappPhoneNumberId: '999' }));

      await service.update('org-1', 'actor-1', 'store-1', { whatsappPhoneNumberId: '999' } as never);

      const written = prisma.store.update.mock.calls[0][0].data;
      expect(written.whatsappPhoneNumberId).toBe('999');
      expect(written).not.toHaveProperty('whatsappAccessTokenEncrypted');
    });
  });
});
