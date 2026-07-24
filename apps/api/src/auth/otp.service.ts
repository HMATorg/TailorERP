import { createHash, randomInt } from 'crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TokenService } from './token.service';

/**
 * Customer phone+OTP auth (PRD C-2, TRD §4.1):
 * - codes live only in Redis, hashed, TTL 5 min
 * - request rate limit: 3 per 15 min per phone
 * - verify attempts capped (D-009) — the code is invalidated when exceeded
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private codeKey(phone: string) {
    return `otp:code:${phone}`;
  }
  private attemptsKey(phone: string) {
    return `otp:attempts:${phone}`;
  }
  private requestsKey(phone: string) {
    return `otp:requests:${phone}`;
  }

  private async resolveCustomer(phone: string, organizationId?: string) {
    const customers = await this.prisma.customer.findMany({
      where: { phone, isActive: true, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, organizationId: true, fullName: true, language: true },
    });
    if (customers.length > 1) {
      throw new ConflictException({
        message: 'Phone registered with multiple tailors — specify organizationId',
        organizations: customers.map((c) => c.organizationId),
      });
    }
    return customers[0] ?? null;
  }

  async requestOtp(phone: string, organizationId?: string) {
    const windowSeconds = Number(this.config.get('OTP_REQUEST_WINDOW_SECONDS', 900));
    const maxRequests = Number(this.config.get('OTP_MAX_REQUESTS_PER_WINDOW', 3));

    const requests = await this.redis.incr(this.requestsKey(phone));
    if (requests === 1) {
      await this.redis.expire(this.requestsKey(phone), windowSeconds);
    }
    if (requests > maxRequests) {
      throw new HttpException(
        'Too many OTP requests — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const customer = await this.resolveCustomer(phone, organizationId);
    // Do not reveal whether the phone exists (enumeration hardening).
    if (!customer) {
      return { sent: true };
    }

    const length = Number(this.config.get('OTP_LENGTH', 4));
    const ttl = Number(this.config.get('OTP_TTL_SECONDS', 300));
    const code = randomInt(0, 10 ** length)
      .toString()
      .padStart(length, '0');

    await this.redis.set(this.codeKey(phone), this.hash(code), 'EX', ttl);
    await this.redis.del(this.attemptsKey(phone));

    // TODO(task #10): deliver via WhatsApp/SMS queue. Dev mode surfaces the code.
    const isDev = this.config.get('NODE_ENV') !== 'production';
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(`[DEV] OTP for ${phone}: ${code}`);
    }
    return { sent: true, ...(isDev ? { devCode: code } : {}) };
  }

  async verifyOtp(phone: string, code: string, organizationId?: string, ip?: string) {
    const maxAttempts = Number(this.config.get('OTP_MAX_VERIFY_ATTEMPTS', 5));
    const attempts = await this.redis.incr(this.attemptsKey(phone));
    if (attempts === 1) {
      await this.redis.expire(this.attemptsKey(phone), 900);
    }
    if (attempts > maxAttempts) {
      await this.redis.del(this.codeKey(phone));
      throw new UnauthorizedException('Too many attempts — request a new code');
    }

    const storedHash = await this.redis.get(this.codeKey(phone));
    if (!storedHash || storedHash !== this.hash(code)) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const customer = await this.resolveCustomer(phone, organizationId);
    if (!customer) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.redis.del(this.codeKey(phone), this.attemptsKey(phone));

    const tokens = await this.tokens.issueTokenPair(
      { sub: customer.id, typ: 'customer', orgId: customer.organizationId },
      ip,
    );
    return {
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        language: customer.language,
      },
      ...tokens,
    };
  }

  async customerRefresh(refreshToken: string, ip?: string) {
    const { subjectId, refreshToken: newRefresh } = await this.tokens.rotateRefreshToken(
      refreshToken,
      'customer',
      ip,
    );
    const customer = await this.prisma.customer.findUnique({
      where: { id: subjectId },
      select: { id: true, organizationId: true, isActive: true },
    });
    if (!customer || !customer.isActive) {
      throw new UnauthorizedException('Account is no longer active');
    }
    const accessToken = await this.tokens.signAccessToken({
      sub: customer.id,
      typ: 'customer',
      orgId: customer.organizationId,
    });
    return {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: this.tokens.accessTtlSeconds('customer'),
    };
  }
}
