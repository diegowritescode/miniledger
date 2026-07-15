import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../journal-transaction';

export interface PostingLine {
  readonly balanceAfter: bigint;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface OriginalPosting {
  readonly accountId: string;
  readonly amount: bigint;
}

export interface OriginalTransaction {
  readonly currency: string;
  readonly postings: readonly OriginalPosting[];
}

export interface JournalTransactionsRepository {
  append(
    journal: JournalTransaction,
    lines: readonly PostingLine[],
    tx?: Tx,
    reversesTransactionId?: string,
  ): Promise<void>;
  findById(id: string, tx?: Tx): Promise<OriginalTransaction | null>;
  hasReversal(transactionId: string, tx?: Tx): Promise<boolean>;
}

export const JOURNAL_TRANSACTIONS_REPOSITORY = Symbol('JOURNAL_TRANSACTIONS_REPOSITORY');
