import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { OrganizationService } from './organization.service';

/**
 * The business-profile fields a receipt/invoice prints (D-069). The one
 * behavior worth locking in: the logo data URI — potentially hundreds of KB —
 * must never land in the audit log verbatim, only whether it changed.
 */
function build() {
  const prisma = {
    organization: { findUnique: jest.fn(), update: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new OrganizationService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Al Anwar Tailors',
  vatNumber: '300012345600003',
  crNumber: null,
  licenseNumber: null,
  logoUrl: null,
  ...overrides,
});

describe('OrganizationService', () => {
  it('getProfile returns the profile fields', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue(profile());

    const result = await service.getProfile('org-1');

    expect(result.name).toBe('Al Anwar Tailors');
  });

  it('getProfile throws when the org does not exist', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.getProfile('org-1')).rejects.toThrow(NotFoundException);
  });

  it('updateProfile only writes fields that were actually sent', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue(profile());
    prisma.organization.update.mockResolvedValue(profile({ crNumber: '1010101010' }));

    await service.updateProfile('org-1', 'user-1', { crNumber: '1010101010' });

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { crNumber: '1010101010' } }),
    );
  });

  it('updateProfile sets logoUrl to null to clear a previously-uploaded logo', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue(profile({ logoUrl: 'data:image/png;base64,AAAA' }));
    prisma.organization.update.mockResolvedValue(profile({ logoUrl: null }));

    await service.updateProfile('org-1', 'user-1', { logoUrl: null });

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { logoUrl: null } }),
    );
  });

  it('updateProfile throws when the org does not exist', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.updateProfile('org-1', 'user-1', { name: 'New name' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('never writes the raw logo data URI to the audit log', async () => {
    const { service, prisma, audit } = build();
    const bigLogo = `data:image/png;base64,${'A'.repeat(1000)}`;
    prisma.organization.findUnique.mockResolvedValue(profile());
    prisma.organization.update.mockResolvedValue(profile({ logoUrl: bigLogo }));

    await service.updateProfile('org-1', 'user-1', { logoUrl: bigLogo });

    const [call] = audit.log.mock.calls;
    const [entry] = call;
    expect(JSON.stringify(entry)).not.toContain(bigLogo);
    expect(entry.newValue.logoUrl).toBe('(set)');
    expect(entry.oldValue.logoUrl).toBe(null);
  });
});
