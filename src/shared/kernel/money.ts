import { type Currency } from './currency';

export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency) {
    super(`cannot combine money in ${left.code} with money in ${right.code}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class Money {
  private constructor(
    readonly amount: bigint,
    readonly currency: Currency,
  ) {}

  static of(amount: bigint, currency: Currency): Money {
    return new Money(amount, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  static sum(monies: readonly Money[], currency: Currency): Money {
    return monies.reduce((total, money) => total.add(money), Money.zero(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency.equals(other.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
