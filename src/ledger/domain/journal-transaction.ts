import { type Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { err, ok, type Result } from '../../shared/result';
import { type AccountId } from './account-id';
import { Posting } from './posting';
import { TransactionId } from './transaction-id';

export type JournalError = 'empty' | 'currency_mismatch' | 'zero_amount_posting' | 'unbalanced';

export class JournalTransaction {
  private constructor(
    readonly id: TransactionId,
    readonly currency: Currency,
    readonly postings: readonly Posting[],
  ) {}

  static create(postings: readonly Posting[]): Result<JournalTransaction, JournalError> {
    const first = postings[0];
    if (!first) return err('empty');

    const currency = first.amount.currency;
    for (const posting of postings) {
      if (!posting.amount.currency.equals(currency)) return err('currency_mismatch');
      if (posting.amount.isZero()) return err('zero_amount_posting');
    }

    const total = Money.sum(
      postings.map((posting) => posting.amount),
      currency,
    );
    if (!total.isZero()) return err('unbalanced');

    return ok(new JournalTransaction(TransactionId.generate(), currency, postings));
  }

  static transfer(
    from: AccountId,
    to: AccountId,
    amount: Money,
  ): Result<JournalTransaction, JournalError> {
    return JournalTransaction.create([Posting.of(from, amount.negate()), Posting.of(to, amount)]);
  }

  static deposit(
    world: AccountId,
    account: AccountId,
    amount: Money,
  ): Result<JournalTransaction, JournalError> {
    return JournalTransaction.transfer(world, account, amount);
  }

  static withdrawal(
    account: AccountId,
    world: AccountId,
    amount: Money,
  ): Result<JournalTransaction, JournalError> {
    return JournalTransaction.transfer(account, world, amount);
  }
}
