import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { AccountId } from './account-id';
import { foldByAccount, totalAmount } from './balance-fold';
import { JournalTransaction } from './journal-transaction';
import { Posting } from './posting';

const currency = (code: string): Currency => {
  const result = Currency.of(code);
  if (!result.ok) throw new Error(`test setup: unknown currency ${code}`);
  return result.value;
};

const USD = currency('USD');
const EUR = currency('EUR');
const usd = (amount: bigint): Money => Money.of(amount, USD);

describe('JournalTransaction.create', () => {
  it('constructs a balanced, single-currency, non-zero transaction', () => {
    const a = AccountId.generate();
    const b = AccountId.generate();
    const result = JournalTransaction.create([Posting.of(a, usd(-100n)), Posting.of(b, usd(100n))]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency.code).toBe('USD');
    expect(totalAmount(result.value.postings)).toBe(0n);
  });

  it('rejects an empty posting set', () => {
    const result = JournalTransaction.create([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('empty');
  });

  it('rejects postings summing to a non-zero amount', () => {
    const result = JournalTransaction.create([
      Posting.of(AccountId.generate(), usd(-100n)),
      Posting.of(AccountId.generate(), usd(90n)),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unbalanced');
  });

  it('rejects a zero-amount posting', () => {
    const result = JournalTransaction.create([
      Posting.of(AccountId.generate(), usd(0n)),
      Posting.of(AccountId.generate(), usd(0n)),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('zero_amount_posting');
  });

  it('rejects mixed currencies', () => {
    const result = JournalTransaction.create([
      Posting.of(AccountId.generate(), usd(-100n)),
      Posting.of(AccountId.generate(), Money.of(100n, EUR)),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('currency_mismatch');
  });

  it('accepts a balanced multi-leg (split) transaction', () => {
    const result = JournalTransaction.create([
      Posting.of(AccountId.generate(), usd(-100n)),
      Posting.of(AccountId.generate(), usd(60n)),
      Posting.of(AccountId.generate(), usd(40n)),
    ]);
    expect(result.ok).toBe(true);
  });
});

describe('JournalTransaction factories', () => {
  it('transfer debits the destination and credits the source', () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const result = JournalTransaction.transfer(from, to, usd(100n));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const balances = foldByAccount(result.value.postings);
    expect(balances.get(from.value)).toBe(-100n);
    expect(balances.get(to.value)).toBe(100n);
    expect(totalAmount(result.value.postings)).toBe(0n);
  });

  it('deposit moves value from @world into the account', () => {
    const world = AccountId.generate();
    const account = AccountId.generate();
    const result = JournalTransaction.deposit(world, account, usd(250n));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const balances = foldByAccount(result.value.postings);
    expect(balances.get(world.value)).toBe(-250n);
    expect(balances.get(account.value)).toBe(250n);
  });

  it('withdrawal moves value from the account back to @world', () => {
    const account = AccountId.generate();
    const world = AccountId.generate();
    const result = JournalTransaction.withdrawal(account, world, usd(80n));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const balances = foldByAccount(result.value.postings);
    expect(balances.get(account.value)).toBe(-80n);
    expect(balances.get(world.value)).toBe(80n);
  });

  it('rejects a zero transfer amount', () => {
    const result = JournalTransaction.transfer(AccountId.generate(), AccountId.generate(), usd(0n));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('zero_amount_posting');
  });
});
