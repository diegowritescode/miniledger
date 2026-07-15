import { type Tx } from '../../../shared/persistence/unit-of-work';

export interface OutboxEvent {
  readonly type: string;
  readonly payload: unknown;
}

export interface OutboxRepository {
  append(event: OutboxEvent, tx?: Tx): Promise<void>;
}

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
