import { Currency } from '../../shared/kernel/currency';
import { type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import { type AccountBalancesRepository } from '../domain/ports/account-balances-repository';
import { type AccountsRepository } from '../domain/ports/accounts-repository';
import { type JournalTransactionsRepository } from '../domain/ports/journal-transactions-repository';
import { TransferService } from './transfer.service';

const at = new Date('2026-06-06T06:00:00.000Z');

const currency = (code: string): Currency => {
  const result = Currency.of(code);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

const userAccount = (id: AccountId, code = 'USD'): Account =>
  Account.reconstitute({
    id,
    type: 'user',
    currency: currency(code),
    overdraftFloor: 0n,
    handle: null,
    createdAt: at,
  });

const worldAccount = (id: AccountId, code = 'USD'): Account =>
  Account.reconstitute({
    id,
    type: 'system',
    currency: currency(code),
    overdraftFloor: null,
    handle: '@world',
    createdAt: at,
  });

const passthroughUow: UnitOfWork = {
  withTransaction: (work) => work({ executor: {} }),
};

interface Mocks {
  service: TransferService;
  append: jest.Mock;
  updateBalance: jest.Mock;
}

const build = (accounts: Account[], locked: Map<string, bigint>): Mocks => {
  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const findById = jest
    .fn<Promise<Account | null>, [AccountId, Tx?]>()
    .mockImplementation((id) => Promise.resolve(byId.get(id.value) ?? null));
  const accountsRepo: AccountsRepository = {
    save: jest.fn(),
    findById,
    findByHandle: jest.fn(),
    list: jest.fn(),
  };

  const append = jest.fn<Promise<void>, unknown[]>().mockResolvedValue();
  const journals = { append } as unknown as JournalTransactionsRepository;

  const updateBalance = jest.fn<Promise<void>, unknown[]>().mockResolvedValue();
  const balances: AccountBalancesRepository = {
    initialize: jest.fn(),
    find: jest.fn(),
    updateBalance,
    lockForUpdate: jest.fn().mockResolvedValue(locked),
  };

  return {
    service: new TransferService(accountsRepo, balances, journals, passthroughUow),
    append,
    updateBalance,
  };
};

describe('TransferService', () => {
  it('moves the amount, records balance_after, and updates both balances', async () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const { service, append, updateBalance } = build(
      [userAccount(from), userAccount(to)],
      new Map([
        [from.value, 1000n],
        [to.value, 0n],
      ]),
    );

    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount: '100',
      currency: 'USD',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.balanceAfter).toEqual([900n, 100n]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(updateBalance).toHaveBeenCalledWith(
      expect.objectContaining({ value: from.value }),
      900n,
      expect.anything(),
    );
    expect(updateBalance).toHaveBeenCalledWith(
      expect.objectContaining({ value: to.value }),
      100n,
      expect.anything(),
    );
  });

  it('lets an exempt @world source go negative (a deposit)', async () => {
    const world = AccountId.generate();
    const to = AccountId.generate();
    const { service, append } = build(
      [worldAccount(world), userAccount(to)],
      new Map([
        [world.value, 0n],
        [to.value, 0n],
      ]),
    );

    const result = await service.transfer({
      from: world.value,
      to: to.value,
      amount: '500',
      currency: 'USD',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.balanceAfter).toEqual([-500n, 500n]);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('rejects a transfer that would overdraw a floored account', async () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const { service, append } = build(
      [userAccount(from), userAccount(to)],
      new Map([
        [from.value, 50n],
        [to.value, 0n],
      ]),
    );

    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount: '100',
      currency: 'USD',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('insufficient_funds');
    expect(append).not.toHaveBeenCalled();
  });

  it('rejects an unknown account', async () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const { service } = build([userAccount(from)], new Map([[from.value, 1000n]]));

    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount: '100',
      currency: 'USD',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown_account');
  });

  it('rejects when an account currency does not match the transfer', async () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const { service } = build(
      [userAccount(from, 'EUR'), userAccount(to, 'USD')],
      new Map([
        [from.value, 1000n],
        [to.value, 0n],
      ]),
    );

    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount: '100',
      currency: 'USD',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('account_currency_mismatch');
  });

  it('rejects an unknown currency', async () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const { service } = build([], new Map());

    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount: '100',
      currency: 'ZZZ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown_currency');
  });

  it('rejects a non-positive amount', async () => {
    const from = AccountId.generate();
    const to = AccountId.generate();
    const { service } = build([], new Map());

    const result = await service.transfer({
      from: from.value,
      to: to.value,
      amount: '0',
      currency: 'USD',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('non_positive_amount');
  });

  it('rejects a transfer to the same account', async () => {
    const account = AccountId.generate();
    const { service } = build([], new Map());

    const result = await service.transfer({
      from: account.value,
      to: account.value,
      amount: '100',
      currency: 'USD',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('same_account');
  });
});
