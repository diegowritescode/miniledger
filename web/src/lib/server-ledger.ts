import { cookies } from 'next/headers';
import { ML_TOKEN_COOKIE, callMiniLedger } from './upstream';
import type { Account, Statement } from './types';

export type LedgerResult<T> = { ok: true; data: T } | { ok: false; status: number };

export function isUnauthorized(result: LedgerResult<unknown>): boolean {
  return !result.ok && result.status === 401;
}

async function get<T>(path: string): Promise<LedgerResult<T>> {
  const store = await cookies();
  const token = store.get(ML_TOKEN_COOKIE)?.value;
  if (!token) {
    return { ok: false, status: 401 };
  }
  try {
    const response = await callMiniLedger(path, { method: 'GET', token });
    if (response.status !== 200) {
      return { ok: false, status: response.status };
    }
    return { ok: true, data: response.body as T };
  } catch {
    return { ok: false, status: 503 };
  }
}

export function getAccounts(): Promise<LedgerResult<Account[]>> {
  return get('/accounts');
}

export function getAccount(id: string): Promise<LedgerResult<Account>> {
  return get(`/accounts/${encodeURIComponent(id)}`);
}

export function getStatement(id: string, limit = 50): Promise<LedgerResult<Statement>> {
  return get(`/accounts/${encodeURIComponent(id)}/statement?limit=${limit}`);
}
