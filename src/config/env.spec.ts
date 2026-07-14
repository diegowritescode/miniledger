import { loadEnv } from './env';

describe('loadEnv', () => {
  it('parses and coerces a valid environment', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toBe('postgres://u:p@localhost:5432/db');
  });

  it('applies defaults for NODE_ENV and PORT', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('applies AccessCore defaults and coerces its numeric vars', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESSCORE_CLOCK_SKEW_SECONDS: '45',
    });

    expect(env.ACCESSCORE_JWT_ISSUER).toBe('https://auth.accesscore.dev');
    expect(env.ACCESSCORE_JWT_AUDIENCE).toBe('accesscore');
    expect(env.ACCESSCORE_CHECK_TIMEOUT_MS).toBe(3000);
    expect(env.ACCESSCORE_CLOCK_SKEW_SECONDS).toBe(45);
  });

  it('throws with actionable detail on invalid configuration (fail-fast)', () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment configuration/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });
});
