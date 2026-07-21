import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginCard } from '@/components/login-card';
import { ML_TOKEN_COOKIE } from '@/lib/upstream';

export default async function LoginPage() {
  const store = await cookies();
  if (store.get(ML_TOKEN_COOKIE)?.value) {
    redirect('/dashboard');
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <LoginCard />
    </main>
  );
}
