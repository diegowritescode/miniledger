import { eq } from 'drizzle-orm';
import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import {
  type IdempotencyClaim,
  type IdempotencyRepository,
} from '../../domain/ports/idempotency-repository';
import { idempotencyKeys } from './idempotency.schema';

export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async claim(key: string, fingerprint: string, tx: Tx): Promise<IdempotencyClaim> {
    const inserted = await this.executor(tx)
      .insert(idempotencyKeys)
      .values({ key, fingerprint })
      .onConflictDoNothing({ target: idempotencyKeys.key })
      .returning({ key: idempotencyKeys.key });
    if (inserted.length > 0) return { owned: true };

    const rows = await this.executor(tx)
      .select({ fingerprint: idempotencyKeys.fingerprint, response: idempotencyKeys.response })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`idempotency key ${key} disappeared after a conflict`);
    return { owned: false, fingerprint: row.fingerprint, response: row.response };
  }

  async complete(key: string, transactionId: string, response: unknown, tx: Tx): Promise<void> {
    await this.executor(tx)
      .update(idempotencyKeys)
      .set({ transactionId, response })
      .where(eq(idempotencyKeys.key, key));
  }
}
