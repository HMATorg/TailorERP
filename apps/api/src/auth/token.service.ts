import { createHash, randomBytes } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthTokens, PrincipalType } from './auth.types';

const REFRESH_TTL_BY_TYPE: Record<PrincipalType, string> = {
  staff: 'JWT_STAFF_REFRESH_TTL',
  customer: 'JWT_STAFF_REFRESH_TTL', // customers share the 7d refresh window
  platform: 'JWT_STAFF_REFRESH_TTL',
};

const ACCESS_TTL_BY_TYPE: Record<PrincipalType, string> = {
  staff: 'JWT_STAFF_ACCESS_TTL',
  customer: 'JWT_CUSTOMER_ACCESS_TTL',
  platform: 'JWT_PLATFORM_ACCESS_TTL',
};

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  accessTtlSeconds(typ: PrincipalType): number {
    return Number(this.config.get(ACCESS_TTL_BY_TYPE[typ], 3600));
  }

  async signAccessToken(payload: AccessTokenPayload, ttlSeconds?: number): Promise<string> {
    return this.jwt.signAsync(payload as unknown as Record<string, unknown>, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ttlSeconds ?? this.accessTtlSeconds(payload.typ),
    });
  }

  async issueTokenPair(payload: AccessTokenPayload, ip?: string): Promise<AuthTokens> {
    const accessToken = await this.signAccessToken(payload);
    const refreshToken = await this.issueRefreshToken(payload.typ, payload.sub, ip);
    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds(payload.typ) };
  }

  async issueRefreshToken(
    subjectType: PrincipalType,
    subjectId: string,
    ip?: string,
  ): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const ttlSeconds = Number(this.config.get(REFRESH_TTL_BY_TYPE[subjectType], 604800));
    await this.prisma.refreshToken.create({
      data: {
        subjectType,
        subjectId,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        ip,
      },
    });
    return raw;
  }

  /**
   * Rotating refresh (TRD §4.1): the presented token is revoked and a new one
   * is issued atomically. A revoked-token replay fails closed.
   */
  async rotateRefreshToken(
    raw: string,
    expectedType: PrincipalType,
    ip?: string,
  ): Promise<{ subjectId: string; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
    });
    if (
      !record ||
      record.subjectType !== expectedType ||
      record.revokedAt !== null ||
      record.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const refreshToken = await this.issueRefreshToken(expectedType, record.subjectId, ip);
    return { subjectId: record.subjectId, refreshToken };
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
