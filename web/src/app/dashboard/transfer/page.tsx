import { redirect } from 'next/navigation';
import { EmptyState, PageHeader, Section } from '@/components/dashboard/kit';
import { TransferForm } from '@/components/dashboard/transfer-form';
import { Callout } from '@/components/ui';
import { getT } from '@/lib/i18n-server';
import { getAccounts, isUnauthorized } from '@/lib/server-ledger';

export default async function TransferPage() {
  const result = await getAccounts();
  if (isUnauthorized(result)) {
    redirect('/login');
  }
  const t = await getT();

  return (
    <>
      <PageHeader title={t('transfer.title')} description={t('transfer.description')} />

      <Section title={t('transfer.formTitle')} description={t('transfer.formDescription')}>
        {!result.ok ? (
          <Callout tone="error">{t('accounts.loadError')}</Callout>
        ) : result.data.length < 1 ? (
          <EmptyState>{t('transfer.needAccounts')}</EmptyState>
        ) : (
          <TransferForm accounts={result.data} />
        )}
      </Section>
    </>
  );
}
