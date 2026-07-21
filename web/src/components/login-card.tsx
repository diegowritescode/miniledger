'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login } from '@/lib/client';
import { useT } from './i18n/language-provider';
import { LanguageToggle } from './i18n/language-toggle';
import { Logo } from './logo';
import { Button, Callout, Field, TextInput } from './ui';

export function LoginCard() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(email.trim(), password);
    if (result.status === 'ok') {
      router.push('/dashboard');
      router.refresh();
      return;
    }
    setBusy(false);
    setError(
      result.status === 'unavailable'
        ? t('errors.loginUnavailable')
        : t('errors.invalidCredentials'),
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-base font-semibold tracking-tight">
            MiniLedger <span className="text-muted">{t('brand.suffix')}</span>
          </span>
        </div>
        <LanguageToggle />
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm shadow-slate-900/[0.04]">
        <h1 className="text-lg font-semibold tracking-tight">{t('login.title')}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{t('login.subtitle')}</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Field label={t('login.email')}>
            <TextInput
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label={t('login.password')} hint={t('login.demoHint')}>
            <TextInput
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error ? <Callout tone="error">{error}</Callout> : null}

          <Button type="submit" disabled={busy || email.trim() === '' || password === ''}>
            {t('login.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
