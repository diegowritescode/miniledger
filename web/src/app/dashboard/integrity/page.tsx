import { redirect } from 'next/navigation';
import { DataTable, EmptyState, PageHeader, Section, Td, Th } from '@/components/dashboard/kit';
import { RefreshButton } from '@/components/dashboard/refresh-button';
import { Badge, Callout } from '@/components/ui';
import { getT } from '@/lib/i18n-server';
import { formatMoney } from '@/lib/money';
import {
  getAccountAudit,
  getAccounts,
  getConservation,
  isUnauthorized,
} from '@/lib/server-ledger';
import type { AccountAudit } from '@/lib/types';

export default async function IntegrityPage() {
  const [conservation, accounts] = await Promise.all([getConservation(), getAccounts()]);
  if (isUnauthorized(conservation) || isUnauthorized(accounts)) {
    redirect('/login');
  }
  const t = await getT();

  const audits: (AccountAudit & { currency: string })[] = [];
  if (accounts.ok) {
    const results = await Promise.all(accounts.data.map((account) => getAccountAudit(account.id)));
    results.forEach((result, index) => {
      const account = accounts.data[index];
      if (result.ok && account) {
        audits.push({ ...result.data, currency: account.currency });
      }
    });
  }

  return (
    <>
      <PageHeader
        title={t('integrity.title')}
        description={t('integrity.description')}
        actions={<RefreshButton label={t('integrity.reverify')} busyLabel={t('integrity.verifying')} />}
      />

      <div className="mb-6">
        <Section title={t('integrity.conservationTitle')} description={t('integrity.conservationDescription')}>
          {!conservation.ok ? (
            <Callout tone="error">{t('integrity.loadError')}</Callout>
          ) : (
            <div className="flex flex-col gap-4">
              <Callout tone={conservation.data.conserved ? 'info' : 'error'}>
                <span className="inline-flex items-center gap-2">
                  <Badge tone={conservation.data.conserved ? 'permit' : 'deny'}>
                    {conservation.data.conserved
                      ? t('integrity.conserved')
                      : t('integrity.notConserved')}
                  </Badge>
                  {t('integrity.conservationExplainer')}
                </span>
              </Callout>
              <div className="flex flex-wrap gap-2">
                {conservation.data.byCurrency.map((entry) => (
                  <div
                    key={entry.currency}
                    className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-muted">{entry.currency}</span>{' '}
                    <span className="font-mono tabular-nums">
                      {formatMoney(entry.total, entry.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      <Section title={t('integrity.chainTitle')} description={t('integrity.chainDescription')}>
        {audits.length === 0 ? (
          <EmptyState>{t('integrity.noAccounts')}</EmptyState>
        ) : (
          <DataTable
            head={
              <tr>
                <Th>{t('integrity.thAccount')}</Th>
                <Th className="text-right">{t('integrity.thPostings')}</Th>
                <Th className="text-right">{t('integrity.thBalance')}</Th>
                <Th className="text-right">{t('integrity.thChain')}</Th>
              </tr>
            }
          >
            {audits.map((audit) => {
              const intact = audit.chainValid && audit.headMatches && audit.reconciled;
              return (
                <tr key={audit.accountId}>
                  <Td>
                    <span className="font-mono text-xs" title={audit.accountId}>
                      {audit.accountId.slice(0, 8)}…
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums text-muted">{audit.postingCount}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {formatMoney(audit.balance, audit.currency)}
                  </Td>
                  <Td className="text-right">
                    <Badge tone={intact ? 'permit' : 'deny'}>
                      {intact
                        ? t('integrity.intact')
                        : t('integrity.broken', { seq: audit.brokenAtSeq ?? 0 })}
                    </Badge>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>
    </>
  );
}
