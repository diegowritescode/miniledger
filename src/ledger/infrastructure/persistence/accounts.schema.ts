import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    currency: text('currency').notNull(),
    overdraftFloor: bigint('overdraft_floor', { mode: 'bigint' }),
    handle: text('handle'),
    ownerId: text('owner_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('accounts_type_check', sql`${table.type} in ('user', 'system')`),
    uniqueIndex('accounts_handle_currency_key')
      .on(table.handle, table.currency)
      .where(sql`${table.handle} is not null`),
    index('accounts_owner_id_idx').on(table.ownerId),
  ],
);
