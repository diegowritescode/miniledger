import { NextResponse } from 'next/server';
import { proxyGet } from '@/lib/bff';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { search } = new URL(request.url);
  return proxyGet(`/accounts/${encodeURIComponent(id)}/statement${search}`);
}
