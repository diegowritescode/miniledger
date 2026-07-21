'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useT } from '@/components/i18n/language-provider';
import { Badge, Button, Callout, Field, Mono, Select, TextInput } from '@/components/ui';
import { transfer } from '@/lib/client';
import { formatMoney, toMinorUnits } from '@/lib/money';
import type { Account, TransferReceipt } from '@/lib/types';

type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok'; receipt: TransferReceipt }
  | { kind: 'error'; message: string };

function accountLabel(account: Account, t: ReturnType<typeof useT>): string {
  const who = account.type === 'system' ? '@world' : t('accounts.you');
  return `${who} · ${account.currency} · ${account.id.slice(0, 8)}… (${formatMoney(account.balance, account.currency)})`;
}

export function TransferForm({ accounts }: { accounts: Account[] }) {
  const t = useT();
  const router = useRouter();

  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const fromAccount = accounts.find((account) => account.id === from);
  const currency = fromAccount?.currency ?? '';

  const toOptions = useMemo(
    () => accounts.filter((account) => account.id !== from && account.currency === currency),
    [accounts, from, currency],
  );

  const [to, setTo] = useState(toOptions[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const effectiveTo = toOptions.some((account) => account.id === to) ? to : (toOptions[0]?.id ?? '');
  const minorUnits = currency ? toMinorUnits(amount, currency) : null;
  const canSubmit =
    from !== '' &&
    effectiveTo !== '' &&
    from !== effectiveTo &&
    minorUnits !== null &&
    minorUnits !== '0' &&
    state.kind !== 'saving';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || minorUnits === null) {
      return;
    }
    setState({ kind: 'saving' });
    const result = await transfer(
      { from, to: effectiveTo, amount: minorUnits, currency },
      idempotencyKey.trim() || undefined,
    );
    if (result.status === 'unauthorized') {
      router.push('/login');
      return;
    }
    if (result.status !== 'ok') {
      setState({
        kind: 'error',
        message: result.status === 'error' ? result.message : t('errors.unavailable'),
      });
      return;
    }
    setState({ kind: 'ok', receipt: result.data });
    setAmount('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('transfer.from')} hint={t('transfer.fromHint')}>
          <Select value={from} onChange={(event) => setFrom(event.target.value)} className="font-mono">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('transfer.to')}>
          <Select
            value={effectiveTo}
            onChange={(event) => setTo(event.target.value)}
            className="font-mono"
            disabled={toOptions.length === 0}
          >
            {toOptions.length === 0 ? (
              <option value="">{t('transfer.noCounterparties')}</option>
            ) : (
              toOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountLabel(account, t)}
                </option>
              ))
            )}
          </Select>
        </Field>
      </div>

      <Field
        label={t('transfer.amount')}
        hint={currency ? t('transfer.amountHint', { currency }) : undefined}
      >
        <TextInput
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="100.00"
          className="w-48 font-mono"
        />
      </Field>

      <Field label={t('transfer.idempotencyKey')} hint={t('transfer.idempotencyHint')}>
        <div className="flex gap-2">
          <TextInput
            value={idempotencyKey}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            placeholder={t('transfer.optional')}
            className="font-mono"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIdempotencyKey(crypto.randomUUID())}
          >
            {t('transfer.generate')}
          </Button>
        </div>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {state.kind === 'saving' ? t('transfer.sending') : t('transfer.send')}
        </Button>
      </div>

      {state.kind === 'error' ? <Callout tone="error">{state.message}</Callout> : null}

      {state.kind === 'ok' ? (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Badge tone="permit">{t('transfer.posted')}</Badge>
            <Mono>{state.receipt.transactionId}</Mono>
          </div>
          <div className="flex flex-col gap-1.5">
            {state.receipt.postings.map((posting, index) => (
              <div key={index} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-muted">{posting.accountId.slice(0, 8)}…</span>
                <span
                  className={`font-mono tabular-nums ${posting.amount.startsWith('-') ? 'text-deny' : 'text-permit'}`}
                >
                  {formatMoney(posting.amount, currency)}
                </span>
                <span className="font-mono text-xs text-muted">
                  → {formatMoney(posting.balanceAfter, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  );
}
