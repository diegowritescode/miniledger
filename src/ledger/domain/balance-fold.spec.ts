import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { AccountId } from './account-id';
import { foldByAccount, totalAmount } from './balance-fold';
import { Posting } from './posting';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('test setup: USD must be supported');
  return result.value;
})();
const usd = (amount: bigint): Money => Money.of(amount, USD);

describe('balance fold', () => {
  it('accumulates multiple postings per account', () => {
    const a = AccountId.generate();
    const b = AccountId.generate();
    const balances = foldByAccount([
      Posting.of(a, usd(100n)),
      Posting.of(a, usd(-30n)),
      Posting.of(b, usd(30n)),
    ]);

    expect(balances.get(a.value)).toBe(70n);
    expect(balances.get(b.value)).toBe(30n);
  });

  it('totals the signed amounts', () => {
    const postings = [
      Posting.of(AccountId.generate(), usd(-100n)),
      Posting.of(AccountId.generate(), usd(100n)),
    ];
    expect(totalAmount(postings)).toBe(0n);
    expect(totalAmount([])).toBe(0n);
  });
});
