import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../journal-transaction';

export interface PostingLine {
  readonly balanceAfter: bigint;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface JournalTransactionsRepository {
  append(journal: JournalTransaction, lines: readonly PostingLine[], tx?: Tx): Promise<void>;
}

export const JOURNAL_TRANSACTIONS_REPOSITORY = Symbol('JOURNAL_TRANSACTIONS_REPOSITORY');
