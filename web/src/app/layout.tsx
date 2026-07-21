import type { Metadata } from 'next';
import { LanguageProvider } from '@/components/i18n/language-provider';
import { getLocale } from '@/lib/i18n-server';
import './globals.css';

export const metadata: Metadata = {
  title: 'MiniLedger Dashboard',
  description:
    'A double-entry financial ledger: idempotent transfers, concurrency-safe balances, and a tamper-evident audit trail. Open accounts, move money, read statements, and verify integrity in real time.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <LanguageProvider locale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
