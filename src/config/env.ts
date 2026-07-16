import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  ACCESSCORE_BASE_URL: z.string().url().default('http://localhost:3001'),
  ACCESSCORE_JWKS_URL: z.string().url().default('http://localhost:3001/.well-known/jwks.json'),
  ACCESSCORE_JWT_ISSUER: z.string().min(1).default('https://auth.accesscore.dev'),
  ACCESSCORE_JWT_AUDIENCE: z.string().min(1).default('accesscore'),
  ACCESSCORE_CLOCK_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(30),
  ACCESSCORE_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
