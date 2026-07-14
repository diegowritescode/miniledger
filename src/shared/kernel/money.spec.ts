import { Currency } from './currency';
import { CurrencyMismatchError, Money } from './money';

const currency = (code: string): Currency => {
  const result = Currency.of(code);
  if (!result.ok) throw new Error(`test setup: unknown currency ${code}`);
  return result.value;
};

const USD = currency('USD');
const EUR = currency('EUR');

describe('Money', () => {
  it('carries a signed amount and its currency', () => {
    const money = Money.of(1234n, USD);
    expect(money.amount).toBe(1234n);
    expect(money.currency.equals(USD)).toBe(true);
  });

  it('exposes zero for a currency', () => {
    expect(Money.zero(USD).isZero()).toBe(true);
    expect(Money.zero(USD).amount).toBe(0n);
  });

  it('treats a positive amount as a debit and a negative amount as a credit', () => {
    expect(Money.of(5n, USD).isNegative()).toBe(false);
    expect(Money.of(-5n, USD).isNegative()).toBe(true);
  });

  it('adds amounts within a currency', () => {
    expect(Money.of(300n, USD).add(Money.of(150n, USD)).amount).toBe(450n);
  });

  it('negates an amount', () => {
    expect(Money.of(150n, USD).negate().amount).toBe(-150n);
  });

  it('sums a list, and an empty list is zero', () => {
    const monies = [Money.of(10n, USD), Money.of(20n, USD), Money.of(-5n, USD)];
    expect(Money.sum(monies, USD).amount).toBe(25n);
    expect(Money.sum([], USD).isZero()).toBe(true);
  });

  it('compares by amount and currency', () => {
    expect(Money.of(10n, USD).equals(Money.of(10n, USD))).toBe(true);
    expect(Money.of(10n, USD).equals(Money.of(11n, USD))).toBe(false);
    expect(Money.of(10n, USD).equals(Money.of(10n, EUR))).toBe(false);
  });

  it('refuses to add across currencies', () => {
    expect(() => Money.of(10n, USD).add(Money.of(10n, EUR))).toThrow(CurrencyMismatchError);
  });

  it('refuses to sum across currencies', () => {
    expect(() => Money.sum([Money.of(10n, USD), Money.of(10n, EUR)], USD)).toThrow(
      CurrencyMismatchError,
    );
  });
});
