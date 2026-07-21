import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  ML_TOKEN_COOKIE,
  ML_USER_COOKIE,
  callAccessCore,
  tokenCookieOptions,
} from '@/lib/upstream';

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(ML_TOKEN_COOKIE)?.value;

  if (token) {
    try {
      await callAccessCore('/auth/logout', { method: 'POST', token });
    } catch {
      // best effort; clearing the cookie below is what matters
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ML_TOKEN_COOKIE, '', tokenCookieOptions(0));
  response.cookies.set(ML_USER_COOKIE, '', tokenCookieOptions(0));
  return response;
}
