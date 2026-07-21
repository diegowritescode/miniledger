import { PageHeader } from '@/components/dashboard/kit';
import { AccountsIcon, IntegrityIcon, TransferIcon } from '@/components/icons';
import type { ComponentType, SVGProps } from 'react';
import { getT } from '@/lib/i18n-server';

const PILLARS: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  titleKey: string;
  bodyKey: string;
}[] = [
  { icon: AccountsIcon, titleKey: 'overview.accountsTitle', bodyKey: 'overview.accountsBody' },
  { icon: TransferIcon, titleKey: 'overview.transferTitle', bodyKey: 'overview.transferBody' },
  { icon: IntegrityIcon, titleKey: 'overview.integrityTitle', bodyKey: 'overview.integrityBody' },
];

export default async function OverviewPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t('overview.title')} description={t('overview.description')} />

      <div className="grid gap-4 sm:grid-cols-3">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <div key={pillar.titleKey} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand-strong">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-3 text-sm font-semibold tracking-tight">{t(pillar.titleKey)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{t(pillar.bodyKey)}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
