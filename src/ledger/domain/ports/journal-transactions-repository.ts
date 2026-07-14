import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../journal-transaction';

export interface JournalTransactionsRepository {
  append(journal: JournalTransaction, balanceAfter: readonly bigint[], tx?: Tx): Promise<void>;
}

export const JOURNAL_TRANSACTIONS_REPOSITORY = Symbol('JOURNAL_TRANSACTIONS_REPOSITORY');
