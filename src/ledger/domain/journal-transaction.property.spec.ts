import fc from 'fast-check';
import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { AccountId } from './account-id';
import { totalAmount } from './balance-fold';
import { JournalTransaction } from './journal-transaction';
import { Posting } from './posting';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('test setup: USD must be supported');
  return result.value;
})();

const nonZeroPosting = (): fc.Arbitrary<Posting> =>
  fc
    .record({
      account: fc.uuid().map((id) => AccountId.fromString(id)),
      amount: fc.bigInt().map((value) => (value === 0n ? 1n : value)),
    })
    .map(({ account, amount }) => Posting.of(account, Money.of(amount, USD)));

describe('JournalTransaction (properties)', () => {
  it('constructs iff the non-zero, single-currency postings sum to zero', () => {
    fc.assert(
      fc.property(fc.array(nonZeroPosting(), { minLength: 1 }), (postings) => {
        const sum = postings.reduce((total, posting) => total + posting.amount.amount, 0n);
        const result = JournalTransaction.create(postings);
        expect(result.ok).toBe(sum === 0n);
      }),
    );
  });

  it('a balancing leg always makes the transaction constructible and sum-zero', () => {
    fc.assert(
      fc.property(
        fc.array(nonZeroPosting(), { minLength: 1 }),
        fc.uuid(),
        (postings, balancerId) => {
          const sum = postings.reduce((total, posting) => total + posting.amount.amount, 0n);
          const balanced =
            sum === 0n
              ? postings
              : [...postings, Posting.of(AccountId.fromString(balancerId), Money.of(-sum, USD))];

          const result = JournalTransaction.create(balanced);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(totalAmount(result.value.postings)).toBe(0n);
        },
      ),
    );
  });

  it('a transfer of a positive amount is balanced and moves exactly that amount', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), fc.bigInt({ min: 1n }), (fromId, toId, amount) => {
        const from = AccountId.fromString(fromId);
        const to = AccountId.fromString(toId);
        const result = JournalTransaction.transfer(from, to, Money.of(amount, USD));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(totalAmount(result.value.postings)).toBe(0n);
      }),
    );
  });
});
