import 'reflect-metadata';
import { validateEnv } from './env.validation';

const MINIMUM = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'access',
  JWT_REFRESH_SECRET: 'refresh',
};

describe('validateEnv', () => {
  it('preserves vars it does not explicitly declare', () => {
    // Regression: Nest replaces the entire config with this return value, so
    // dropping undeclared keys silently disables push, WhatsApp, and OTP config.
    const result = validateEnv({
      ...MINIMUM,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      TOKEN_ENCRYPTION_KEY: 'k'.repeat(64),
      OTP_LENGTH: '6',
      WHATSAPP_APP_SECRET: 'secret',
    });

    expect(result.VAPID_PUBLIC_KEY).toBe('pub');
    expect(result.VAPID_PRIVATE_KEY).toBe('priv');
    expect(result.TOKEN_ENCRYPTION_KEY).toBe('k'.repeat(64));
    expect(result.OTP_LENGTH).toBe('6');
    expect(result.WHATSAPP_APP_SECRET).toBe('secret');
  });

  it('applies defaults for optional declared vars', () => {
    const result = validateEnv({ ...MINIMUM });
    expect(result.PORT).toBe(3000);
    expect(result.REDIS_PORT).toBe(6379);
    expect(result.NODE_ENV).toBe('development');
  });

  it('coerces numeric strings to numbers', () => {
    const result = validateEnv({ ...MINIMUM, PORT: '8080', REDIS_PORT: '6380' });
    expect(result.PORT).toBe(8080);
    expect(result.REDIS_PORT).toBe(6380);
  });

  it('throws when a required var is missing', () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws on an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...MINIMUM, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
