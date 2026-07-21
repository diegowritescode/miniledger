'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/i18n/language-provider';
import { DataTable, EmptyState, Td, Th } from '@/components/dashboard/kit';
import { Button, Callout } from '@/components/ui';
import { fetchStatement } from '@/lib/client';
import { formatMoney } from '@/lib/money';
import type { StatementEntry } from '@/lib/types';

export function StatementView({
  accountId,
  currency,
  initialEntries,
  initialCursor,
}: {
  accountId: string;
  currency: string;
  initialEntries: StatementEntry[];
  initialCursor: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const [entries, setEntries] = useState<StatementEntry[]>(initialEntries);
  const [cursor, setCursor] = useState<number | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (cursor === null) return;
    setLoading(true);
    setError(null);
    const result = await fetchStatement(accountId, cursor);
    if (result.status === 'unauthorized') {
      router.push('/login');
      return;
    }
    if (result.status !== 'ok') {
      setLoading(false);
      setError(result.status === 'error' ? result.message : t('errors.unavailable'));
      return;
    }
    setEntries((current) => [...current, ...result.data.entries]);
    setCursor(result.data.nextCursor);
    setLoading(false);
  }

  if (entries.length === 0) {
    return <EmptyState>{t('statement.empty')}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        head={
          <tr>
            <Th className="text-right">{t('statement.thSeq')}</Th>
            <Th>{t('statement.thDate')}</Th>
            <Th>{t('statement.thTxn')}</Th>
            <Th className="text-right">{t('statement.thAmount')}</Th>
            <Th className="text-right">{t('statement.thBalance')}</Th>
          </tr>
        }
      >
        {entries.map((entry) => (
          <tr key={entry.seq}>
            <Td className="text-right tabular-nums text-muted">{entry.seq}</Td>
            <Td className="whitespace-nowrap text-xs text-muted">
              {entry.createdAt.slice(0, 19).replace('T', ' ')}
            </Td>
            <Td>
              <span className="font-mono text-xs" title={entry.transactionId}>
                {entry.transactionId.slice(0, 8)}…
              </span>
            </Td>
            <Td
              className={`text-right font-mono tabular-nums ${entry.amount.startsWith('-') ? 'text-deny' : 'text-permit'}`}
            >
              {formatMoney(entry.amount, currency)}
            </Td>
            <Td className="text-right font-mono tabular-nums">
              {formatMoney(entry.balanceAfter, currency)}
            </Td>
          </tr>
        ))}
      </DataTable>

      {error ? <Callout tone="error">{error}</Callout> : null}

      {cursor !== null ? (
        <div>
          <Button type="button" variant="secondary" onClick={loadMore} disabled={loading}>
            {loading ? t('statement.loading') : t('statement.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
