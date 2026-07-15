import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});
