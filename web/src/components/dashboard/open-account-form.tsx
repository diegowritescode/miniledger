'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/i18n/language-provider';
import { Button, Callout, Field, Select } from '@/components/ui';
import { openAccount } from '@/lib/client';
import { CURRENCY_CODES } from '@/lib/money';

export function OpenAccountForm() {
  const t = useT();
  const router = useRouter();
  const [currency, setCurrency] = useState(CURRENCY_CODES[0] ?? 'USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await openAccount(currency);
    if (result.status === 'unauthorized') {
      router.push('/login');
      return;
    }
    if (result.status !== 'ok') {
      setBusy(false);
      setError(result.status === 'error' ? result.message : t('errors.unavailable'));
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field label={t('accounts.currency')} className="w-40">
        <Select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="font-mono"
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? t('accounts.opening') : t('accounts.open')}
      </Button>
      {error ? (
        <div className="w-full">
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}
    </form>
  );
}
