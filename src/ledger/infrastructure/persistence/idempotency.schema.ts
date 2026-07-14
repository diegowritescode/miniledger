import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { journalTransactions } from './journal-transactions.schema';

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  transactionId: uuid('transaction_id').references(() => journalTransactions.id),
  response: jsonb('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
