import { Currency } from '../../shared/kernel/currency';
import { type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import { type AccountBalancesRepository } from '../domain/ports/account-balances-repository';
import { type AccountsRepository } from '../domain/ports/accounts-repository';
import {
  type IdempotencyClaim,
  type IdempotencyRepository,
} from '../domain/ports/idempotency-repository';
import { type JournalTransactionsRepository } from '../domain/ports/journal-transactions-repository';
import { TransferService } from './transfer.service';

const at = new Date('2026-06-06T06:00:00.000Z');

const currency = (code: string): Currency => {
  const result = Currency.of(code);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

const userAccount = (id: AccountId, code = 'USD', ownerId = 'owner-1'): Account =>
  Account.reconstitute({
    id,
    type: 'user',
    currency: currency(code),
    overdraftFloor: 0n,
    handle: null,
    ownerId,
    createdAt: at,
  });

const worldAccount = (id: AccountId, code = 'USD'): Account =>
  Account.reconstitute({
    id,
    type: 'system',
    currency: currency(code),
    overdraftFloor: null,
    handle: '@world',
    ownerId: null,
    createdAt: at,
  });

const passthroughUow: UnitOfWork = {
  withTransaction: (work) => work({ executor: {} }),
};

interface Options {
  claim?: jest.Mock<Promise<IdempotencyClaim>, [string, string, Tx]>;
}

interface Mocks {
  service: TransferService;
  append: jest.Mock;
  updateBalance: jest.Mock;
  claim: jest.Mock<Promise<IdempotencyClaim>, [string, string, Tx]>;
  complete: jest.Mock;
}

const build = (accounts: Account[], locked: Map<string, bigint>, options: Options = {}): Mocks => {
  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const findById = jest
    .fn<Promise<Account | null>, [AccountId, Tx?]>()
    .mockImplementation((id) => Promise.resolve(byId.get(id.value) ?? null));
  const accountsRepo: AccountsRepository = {
    save: jest.fn(),
    findById,
    findByHandle: jest.fn(),
    list: jest.fn(),
    listVisibleTo: jest.fn(),
  };

  const append = jest.fn<Promise<void>, unknown[]>().mockResolvedValue();
  const journals = { append } as unknown as JournalTransactionsRepository;

  const updateBalance = jest.fn<Promise<void>, unknown[]>().mockResolvedValue();
  const lockedState = new Map(
    [...locked].map(([id, balance]) => [id, { balance, chainHash: null }] as const),
  );
  const balances: AccountBalancesRepository = {
    initialize: jest.fn(),
    find: jest.fn(),
    updateBalance,
    lockForUpdate: jest.fn().mockResolvedValue(lockedState),
  };

  const claim =
    options.claim ??
    jest.fn<Promise<IdempotencyClaim>, [string, string, Tx]>().mockResolvedValue({ owned: true });
  const complete = jest.fn<Promise<void>, unknown[]>().mockResolvedValue();
  const idempotency: IdempotencyRepository = { claim, complete };

  return {
    service: new TransferService(accountsRepo, balances, journals, idempotency, passthroughUow),
    append,
    updateBalance,
    claim,
    complete,
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
      ownerId: 'owner-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.postings.map((posting) => posting.balanceAfter)).toEqual(['900', '100']);
    expect(append).toHaveBeenCalledTimes(1);
    expect(updateBalance).toHaveBeenCalledWith(
      expect.objectContaining({ value: from.value }),
      900n,
      expect.any(String),
      expect.anything(),
    );
    expect(updateBalance).toHaveBeenCalledWith(
      expect.objectContaining({ value: to.value }),
      100n,
      expect.any(String),
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
      ownerId: 'owner-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.postings.map((posting) => posting.balanceAfter)).toEqual(['-500', '500']);
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
      ownerId: 'owner-1',
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
      ownerId: 'owner-1',
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
      ownerId: 'owner-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('account_currency_mismatch');
  });

  it('rejects an unknown currency', async () => {
    const { service } = build([], new Map());

    const result = await service.transfer({
      from: AccountId.generate().value,
      to: AccountId.generate().value,
      amount: '100',
      currency: 'ZZZ',
      ownerId: 'owner-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown_currency');
  });

  it('rejects a non-positive amount', async () => {
    const { service } = build([], new Map());

    const result = await service.transfer({
      from: AccountId.generate().value,
      to: AccountId.generate().value,
      amount: '0',
      currency: 'USD',
      ownerId: 'owner-1',
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
      ownerId: 'owner-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('same_account');
  });

  describe('ownership', () => {
    it('rejects a transfer whose source is owned by a different subject', async () => {
      const from = AccountId.generate();
      const to = AccountId.generate();
      const { service, append } = build(
        [userAccount(from, 'USD', 'owner-2'), userAccount(to)],
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
        ownerId: 'owner-1',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('not_account_owner');
      expect(append).not.toHaveBeenCalled();
    });

    it('exempts a system @world source from the ownership check', async () => {
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
        ownerId: 'unrelated-subject',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(append).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency', () => {
    it('executes and records the response when the key is unclaimed', async () => {
      const from = AccountId.generate();
      const to = AccountId.generate();
      const { service, append, complete } = build(
        [userAccount(from), userAccount(to)],
        new Map([
          [from.value, 1000n],
          [to.value, 0n],
        ]),
        { claim: jest.fn().mockResolvedValue({ owned: true }) },
      );

      const result = await service.transfer({
        from: from.value,
        to: to.value,
        amount: '100',
        currency: 'USD',
        ownerId: 'owner-1',
        idempotencyKey: 'key-1',
      });

      expect(result.ok).toBe(true);
      expect(append).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('replays the stored response for a duplicate key without re-executing', async () => {
      const from = AccountId.generate();
      const to = AccountId.generate();
      const stored = { id: 'stored', currency: 'USD', postings: [] };
      const { service, append, complete } = build(
        [userAccount(from), userAccount(to)],
        new Map([
          [from.value, 1000n],
          [to.value, 0n],
        ]),
        {
          claim: jest
            .fn<Promise<IdempotencyClaim>, [string, string, Tx]>()
            .mockImplementation((_key, fingerprint) =>
              Promise.resolve({ owned: false, fingerprint, response: stored }),
            ),
        },
      );

      const result = await service.transfer({
        from: from.value,
        to: to.value,
        amount: '100',
        currency: 'USD',
        ownerId: 'owner-1',
        idempotencyKey: 'key-1',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(stored);
      expect(append).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('rejects a key reused for a different request', async () => {
      const from = AccountId.generate();
      const to = AccountId.generate();
      const { service, append } = build(
        [userAccount(from), userAccount(to)],
        new Map([
          [from.value, 1000n],
          [to.value, 0n],
        ]),
        {
          claim: jest.fn<Promise<IdempotencyClaim>, [string, string, Tx]>().mockResolvedValue({
            owned: false,
            fingerprint: 'a-different-fingerprint',
            response: {},
          }),
        },
      );

      const result = await service.transfer({
        from: from.value,
        to: to.value,
        amount: '100',
        currency: 'USD',
        ownerId: 'owner-1',
        idempotencyKey: 'key-1',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('idempotency_conflict');
      expect(append).not.toHaveBeenCalled();
    });
  });
});
