import { NextResponse } from 'next/server';
import { proxyAuthorized, proxyGet } from '@/lib/bff';

export async function GET(): Promise<NextResponse> {
  return proxyGet('/accounts');
}

export async function POST(request: Request): Promise<NextResponse> {
  return proxyAuthorized(request, '/accounts', 'POST');
}
