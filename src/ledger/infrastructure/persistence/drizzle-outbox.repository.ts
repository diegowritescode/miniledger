import { type Database } from '../../../db/db.module';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type OutboxEvent, type OutboxRepository } from '../../domain/ports/outbox-repository';
import { outbox } from './outbox.schema';

export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Database) {}

  private executor(tx?: Tx): Database {
    return tx ? (tx.executor as Database) : this.db;
  }

  async append(event: OutboxEvent, tx?: Tx): Promise<void> {
    await this.executor(tx).insert(outbox).values({ type: event.type, payload: event.payload });
  }
}
