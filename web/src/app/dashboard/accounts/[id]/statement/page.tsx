import { redirect } from 'next/navigation';
import { ButtonLink, PageHeader, Section } from '@/components/dashboard/kit';
import { StatementView } from '@/components/dashboard/statement-view';
import { Badge, Callout } from '@/components/ui';
import { getT } from '@/lib/i18n-server';
import { formatMoney } from '@/lib/money';
import { getAccount, getStatement, isUnauthorized } from '@/lib/server-ledger';

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountResult = await getAccount(id);
  if (isUnauthorized(accountResult)) {
    redirect('/login');
  }
  const t = await getT();

  if (!accountResult.ok) {
    return (
      <>
        <PageHeader title={t('statement.title')} />
        <Callout tone="error">{t('statement.notFound')}</Callout>
      </>
    );
  }

  const account = accountResult.data;
  const statementResult = await getStatement(id);

  return (
    <>
      <PageHeader
        title={t('statement.title')}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge tone={account.type === 'system' ? 'brand' : undefined}>
              {account.type === 'system' ? '@world' : t('accounts.you')}
            </Badge>
            <span className="font-mono text-xs">{account.id}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">
              {formatMoney(account.balance, account.currency)} {account.currency}
            </span>
          </span>
        }
        actions={
          <ButtonLink href="/dashboard/accounts" variant="secondary">
            {t('statement.back')}
          </ButtonLink>
        }
      />

      <Section title={t('statement.sectionTitle')} description={t('statement.sectionDescription')}>
        {!statementResult.ok ? (
          <Callout tone="error">{t('statement.loadError')}</Callout>
        ) : (
          <StatementView
            accountId={account.id}
            currency={account.currency}
            initialEntries={statementResult.data.entries}
            initialCursor={statementResult.data.nextCursor}
          />
        )}
      </Section>
    </>
  );
}
