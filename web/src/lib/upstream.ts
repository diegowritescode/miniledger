export const ML_TOKEN_COOKIE = 'ml_token';
export const ML_USER_COOKIE = 'ml_user';

const trim = (value: string): string => value.replace(/\/+$/, '');

export const ACCESSCORE_API_URL = trim(
  process.env.ACCESSCORE_API_URL ?? 'https://auth.deviego.xyz',
);
export const MINILEDGER_API_URL = trim(
  process.env.MINILEDGER_API_URL ?? 'https://ledger.deviego.xyz',
);

export const ML_TOKEN_MAX_AGE_SECONDS = 15 * 60;

export interface UpstreamResult {
  status: number;
  body: unknown;
}

interface CallOptions {
  method: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function call(baseUrl: string, path: string, options: CallOptions): Promise<UpstreamResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  const raw = await response.text();
  let body: unknown = null;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { message: raw };
    }
  }

  return { status: response.status, body };
}

export function callAccessCore(path: string, options: CallOptions): Promise<UpstreamResult> {
  return call(ACCESSCORE_API_URL, path, options);
}

export function callMiniLedger(path: string, options: CallOptions): Promise<UpstreamResult> {
  return call(MINILEDGER_API_URL, path, options);
}

export function tokenCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
