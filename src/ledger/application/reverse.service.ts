import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { UNIT_OF_WORK, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { err, ok, type Result } from '../../shared/result';
import { AccountId } from '../domain/account-id';
import { JournalTransaction } from '../domain/journal-transaction';
import { Posting } from '../domain/posting';
import {
  JOURNAL_TRANSACTIONS_REPOSITORY,
  type JournalTransactionsRepository,
} from '../domain/ports/journal-transactions-repository';
import { LedgerPoster, LedgerPostingFailure, type TransferReceipt } from './ledger-poster';

export type ReverseError = 'unknown_transaction' | 'already_reversed' | 'insufficient_funds';

const REVERSES_UNIQUE_CONSTRAINT = 'journal_transactions_reverses_transaction_id_key';

class AlreadyReversedError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === REVERSES_UNIQUE_CONSTRAINT;
}

@Injectable()
export class ReverseService {
  constructor(
    @Inject(JOURNAL_TRANSACTIONS_REPOSITORY)
    private readonly journals: JournalTransactionsRepository,
    private readonly poster: LedgerPoster,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async reverse(transactionId: string): Promise<Result<TransferReceipt, ReverseError>> {
    const original = await this.journals.findById(transactionId);
    if (!original) return err('unknown_transaction');

    const currency = Currency.of(original.currency);
    if (!currency.ok) {
      throw new Error(`transaction ${transactionId} has an unknown currency: ${original.currency}`);
    }

    const legs = original.postings.map((posting) =>
      Posting.of(
        AccountId.fromString(posting.accountId),
        Money.of(posting.amount, currency.value).negate(),
      ),
    );
    const built = JournalTransaction.create(legs);
    if (!built.ok) {
      throw new Error(`transaction ${transactionId} cannot be compensated: ${built.error}`);
    }
    const compensating = built.value;

    try {
      const receipt = await this.uow.withTransaction(async (tx) => {
        if (await this.journals.hasReversal(transactionId, tx)) {
          throw new AlreadyReversedError();
        }
        return this.poster.post(
          compensating,
          currency.value,
          {
            requireOwner: null,
            eventType: 'transfer.reversed',
            reversesTransactionId: transactionId,
          },
          tx,
        );
      });
      return ok(receipt);
    } catch (error) {
      if (error instanceof AlreadyReversedError || isUniqueViolation(error)) {
        return err('already_reversed');
      }
      if (error instanceof LedgerPostingFailure && error.code === 'insufficient_funds') {
        return err('insufficient_funds');
      }
      throw error;
    }
  }
}
