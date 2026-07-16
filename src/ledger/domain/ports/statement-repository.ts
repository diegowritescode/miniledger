import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../account-id';

export interface StatementEntry {
  readonly seq: number;
  readonly transactionId: string;
  readonly amount: bigint;
  readonly balanceAfter: bigint;
  readonly createdAt: Date;
}

export interface StatementRepository {
  page(
    accountId: AccountId,
    limit: number,
    afterSeq: number | null,
    tx?: Tx,
  ): Promise<StatementEntry[]>;
}

export const STATEMENT_REPOSITORY = Symbol('STATEMENT_REPOSITORY');
