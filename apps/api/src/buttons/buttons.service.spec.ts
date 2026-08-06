import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ButtonsService } from './buttons.service';

/**
 * The shop's own button catalog (D-071). The one behavior worth locking in
 * hardest: the image data URI must never land in the audit log verbatim,
 * matching the same rule the org logo already follows (D-069).
 */
function build() {
  const prisma = {
    buttonDesign: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ButtonsService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const button = (overrides: Record<string, unknown> = {}) => ({
  id: 'button-1',
  serialNumber: '153',
  imageUrl: 'data:image/png;base64,AAAA',
  label: null,
  isActive: true,
  createdAt: new Date(),
  ...overrides,
});

describe('ButtonsService', () => {
  it('list defaults to active-only for the POS picker', async () => {
    const { service, prisma } = build();
    prisma.buttonDesign.findMany.mockResolvedValue([]);

    await service.list('org-1');

    expect(prisma.buttonDesign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', isActive: true } }),
    );
  });

  it('list includes inactive rows for the admin management view', async () => {
    const { service, prisma } = build();
    prisma.buttonDesign.findMany.mockResolvedValue([]);

    await service.list('org-1', true);

    expect(prisma.buttonDesign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
  });

  it('create rejects a serial number already used in this org', async () => {
    const { service, prisma } = build();
    prisma.buttonDesign.findUnique.mockResolvedValue(button());

    await expect(
      service.create('org-1', 'user-1', { serialNumber: '153', imageUrl: 'data:image/png;base64,AAAA' }),
    ).rejects.toThrow(ConflictException);
  });

  it('update throws when the button does not belong to this org', async () => {
    const { service, prisma } = build();
    prisma.buttonDesign.findFirst.mockResolvedValue(null);

    await expect(service.update('org-1', 'user-1', 'button-1', { label: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('never writes the raw image data URI to the audit log', async () => {
    const { service, prisma, audit } = build();
    const bigImage = `data:image/png;base64,${'A'.repeat(1000)}`;
    prisma.buttonDesign.findUnique.mockResolvedValue(null);
    prisma.buttonDesign.create.mockResolvedValue(button({ imageUrl: bigImage, label: 'Pearl' }));

    await service.create('org-1', 'user-1', { serialNumber: '153', imageUrl: bigImage, label: 'Pearl' });

    const [entry] = audit.log.mock.calls[0];
    expect(JSON.stringify(entry)).not.toContain(bigImage);
    expect(entry.newValue).toEqual({ serialNumber: '153', label: 'Pearl' });
  });
});
