import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { ML_TOKEN_COOKIE, ML_USER_COOKIE } from '@/lib/upstream';
import { decodeIdentity } from '@/lib/identity';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const token = store.get(ML_TOKEN_COOKIE)?.value;
  if (!token) {
    redirect('/login');
  }
  const email = store.get(ML_USER_COOKIE)?.value ?? null;
  const identity = decodeIdentity(token, email);

  return <DashboardShell identity={identity}>{children}</DashboardShell>;
}
