import { redirect } from 'next/navigation';
import { DataTable, EmptyState, PageHeader, Section, Td, Th } from '@/components/dashboard/kit';
import { OpenAccountForm } from '@/components/dashboard/open-account-form';
import { Badge, Callout } from '@/components/ui';
import { getT } from '@/lib/i18n-server';
import { formatMoney } from '@/lib/money';
import { getAccounts, isUnauthorized } from '@/lib/server-ledger';

export default async function AccountsPage() {
  const result = await getAccounts();
  if (isUnauthorized(result)) {
    redirect('/login');
  }
  const t = await getT();

  return (
    <>
      <PageHeader title={t('accounts.title')} description={t('accounts.description')} />

      <div className="mb-6">
        <Section title={t('accounts.openTitle')} description={t('accounts.openDescription')}>
          <OpenAccountForm />
        </Section>
      </div>

      {!result.ok ? (
        <Callout tone="error">{t('accounts.loadError')}</Callout>
      ) : result.data.length === 0 ? (
        <EmptyState>{t('accounts.empty')}</EmptyState>
      ) : (
        <DataTable
          head={
            <tr>
              <Th>{t('accounts.thAccount')}</Th>
              <Th>{t('accounts.thType')}</Th>
              <Th>{t('accounts.thCurrency')}</Th>
              <Th className="text-right">{t('accounts.thBalance')}</Th>
            </tr>
          }
        >
          {result.data.map((account) => (
            <tr key={account.id}>
              <Td>
                <span className="font-mono text-xs" title={account.id}>
                  {account.id.slice(0, 8)}…
                </span>
              </Td>
              <Td>
                <Badge tone={account.type === 'system' ? 'brand' : undefined}>
                  {account.type === 'system' ? t('accounts.system') : t('accounts.you')}
                </Badge>
              </Td>
              <Td className="font-mono">{account.currency}</Td>
              <Td className="text-right font-mono tabular-nums">
                {formatMoney(account.balance, account.currency)}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
