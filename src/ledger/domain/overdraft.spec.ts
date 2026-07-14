import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { isSufficient } from './overdraft';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('test setup: USD must be supported');
  return result.value;
})();
const usd = (amount: bigint): Money => Money.of(amount, USD);

describe('isSufficient', () => {
  it('is always sufficient for an exempt (null-floor) account', () => {
    expect(isSufficient(usd(0n), usd(-1_000_000n), null)).toBe(true);
  });

  it('permits a debit that lands exactly on the floor', () => {
    expect(isSufficient(usd(100n), usd(-100n), 0n)).toBe(true);
  });

  it('rejects a debit that would cross the floor', () => {
    expect(isSufficient(usd(100n), usd(-101n), 0n)).toBe(false);
  });

  it('permits any credit', () => {
    expect(isSufficient(usd(0n), usd(50n), 0n)).toBe(true);
  });
});
