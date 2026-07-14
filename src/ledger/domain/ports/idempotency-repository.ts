import { type Tx } from '../../../shared/persistence/unit-of-work';

export type IdempotencyClaim =
  | { readonly owned: true }
  | { readonly owned: false; readonly fingerprint: string; readonly response: unknown };

export interface IdempotencyRepository {
  claim(key: string, fingerprint: string, tx: Tx): Promise<IdempotencyClaim>;
  complete(key: string, transactionId: string, response: unknown, tx: Tx): Promise<void>;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');
