import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ML_TOKEN_COOKIE, callMiniLedger } from './upstream';

export async function proxyGet(upstreamPath: string): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(ML_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }
  try {
    const upstream = await callMiniLedger(upstreamPath, { method: 'GET', token });
    return NextResponse.json(upstream.body ?? {}, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}

export async function proxyAuthorized(
  request: Request,
  upstreamPath: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(ML_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const headers: Record<string, string> = {};
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey) {
    headers['idempotency-key'] = idempotencyKey;
  }

  try {
    const upstream = await callMiniLedger(upstreamPath, { method, token, body, headers });
    return NextResponse.json(upstream.body ?? {}, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
