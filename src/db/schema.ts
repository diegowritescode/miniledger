import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export * from '../ledger/infrastructure/persistence/accounts.schema';
export * from '../ledger/infrastructure/persistence/journal-transactions.schema';
export * from '../ledger/infrastructure/persistence/account-balances.schema';

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
