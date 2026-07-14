import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.schema';

export const journalTransactions = pgTable('journal_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  currency: text('currency').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => journalTransactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'bigint' }).notNull(),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('postings_amount_nonzero', sql`${table.amount} <> 0`),
    index('postings_transaction_id_idx').on(table.transactionId),
    index('postings_account_id_idx').on(table.accountId),
  ],
);
