import type { INestApplicationContext } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One-time production bootstrap: creates the first platform admin from
 * PLATFORM_ADMIN_SEED_EMAIL/PLATFORM_ADMIN_SEED_PASSWORD when neither is
 * unset and no platform admin exists yet. No-op once one exists, so it's
 * safe to leave wired into every boot rather than pulled out after use.
 * Never throws — a failure here must not take the API down with it (the
 * same lesson D-061 already learned from the reorder-cron bootstrap hang).
 */
export async function seedPlatformAdminIfConfigured(app: INestApplicationContext): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_SEED_EMAIL;
  const password = process.env.PLATFORM_ADMIN_SEED_PASSWORD;
  if (!email || !password) return;

  const prisma = app.get(PrismaService);
  try {
    const existing = await prisma.platformAdmin.findFirst();
    if (existing) return;

    const normalizedEmail = email.toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: normalizedEmail, passwordHash, fullName: 'Platform Admin' },
      });
      await tx.platformAdmin.create({ data: { userId: user.id, adminLevel: 'super_admin' } });
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded initial platform admin: ${normalizedEmail}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Platform admin seed skipped — ${(err as Error).message}`);
  }
}
