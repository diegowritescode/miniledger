import { type Clock } from '../../shared/kernel/clock';
import { Currency } from '../../shared/kernel/currency';
import { type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import {
  type AccountBalancesRepository,
  type LockedBalance,
} from '../domain/ports/account-balances-repository';
import { type AccountsRepository } from '../domain/ports/accounts-repository';
import { AccountsService } from './accounts.service';

const fixedNow = new Date('2026-03-03T09:00:00.000Z');

const clock: Clock = { now: () => fixedNow };

const usd = (): Currency => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

const systemAccount = (): Account =>
  Account.reconstitute({
    id: AccountId.generate(),
    type: 'system',
    currency: usd(),
    overdraftFloor: null,
    handle: '@world',
    ownerId: null,
    createdAt: fixedNow,
  });

interface RepoMocks {
  readonly repository: AccountsRepository;
  readonly save: jest.Mock<Promise<void>, [Account, Tx?]>;
  readonly findById: jest.Mock<Promise<Account | null>, [AccountId, Tx?]>;
  readonly listVisibleTo: jest.Mock<Promise<Account[]>, [string, Tx?]>;
}

const buildRepo = (
  overrides: Partial<Pick<RepoMocks, 'save' | 'findById' | 'listVisibleTo'>> = {},
): RepoMocks => {
  const save = overrides.save ?? jest.fn<Promise<void>, [Account, Tx?]>().mockResolvedValue();
  const findById =
    overrides.findById ??
    jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(null);
  const listVisibleTo =
    overrides.listVisibleTo ?? jest.fn<Promise<Account[]>, [string, Tx?]>().mockResolvedValue([]);
  const findByHandle = jest.fn().mockResolvedValue(null);
  const repository: AccountsRepository = { save, findById, findByHandle, listVisibleTo };
  return { repository, save, findById, listVisibleTo };
};

interface BalancesMocks {
  readonly repository: AccountBalancesRepository;
  readonly initialize: jest.Mock<Promise<void>, [AccountId, Tx?]>;
}

const buildBalances = (): BalancesMocks => {
  const initialize = jest.fn<Promise<void>, [AccountId, Tx?]>().mockResolvedValue();
  const find = jest.fn<Promise<bigint | null>, [AccountId, Tx?]>().mockResolvedValue(null);
  const updateBalance = jest
    .fn<Promise<void>, [AccountId, bigint, string | null, Tx?]>()
    .mockResolvedValue();
  const lockForUpdate = jest
    .fn<Promise<Map<string, LockedBalance>>, [readonly AccountId[], Tx]>()
    .mockResolvedValue(new Map());
  const repository: AccountBalancesRepository = { initialize, find, updateBalance, lockForUpdate };
  return { repository, initialize };
};

const passthroughUow: UnitOfWork = {
  withTransaction: (work) => work({ executor: {} }),
};

const buildService = (repository: AccountsRepository, balances: AccountBalancesRepository) =>
  new AccountsService(repository, balances, passthroughUow, clock);

describe('AccountsService', () => {
  describe('open', () => {
    it('opens a user account owned by the subject and persists it in a transaction', async () => {
      const { repository, save } = buildRepo();
      const balances = buildBalances();
      const service = buildService(repository, balances.repository);

      const result = await service.open({ currency: 'USD', ownerId: 'user-1' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe('user');
      expect(result.value.ownerId).toBe('user-1');
      expect(result.value.createdAt).toBe(fixedNow);
      const [savedAccount, tx] = save.mock.calls[0] ?? [];
      expect(savedAccount).toBeInstanceOf(Account);
      expect(tx).toBeDefined();
    });

    it('initializes the balance row once, in the same transaction as the account', async () => {
      const { repository, save } = buildRepo();
      const balances = buildBalances();
      const service = buildService(repository, balances.repository);

      const result = await service.open({ currency: 'USD', ownerId: 'user-1' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(balances.initialize).toHaveBeenCalledTimes(1);
      const [accountId, initTx] = balances.initialize.mock.calls[0] ?? [];
      const [, saveTx] = save.mock.calls[0] ?? [];
      expect(accountId?.value).toBe(result.value.id.value);
      expect(initTx).toBe(saveTx);
    });

    it('rejects an unknown currency without touching the repository', async () => {
      const { repository, save } = buildRepo();
      const balances = buildBalances();
      const service = buildService(repository, balances.repository);

      const result = await service.open({ currency: 'ZZZ', ownerId: 'user-1' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('unknown_currency');
      expect(save).not.toHaveBeenCalled();
      expect(balances.initialize).not.toHaveBeenCalled();
    });
  });

  describe('getVisible', () => {
    it("resolves the caller's own account", async () => {
      const account = Account.openUser(usd(), 'user-1', fixedNow);
      const { repository } = buildRepo({
        findById: jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(account),
      });
      const service = buildService(repository, buildBalances().repository);

      expect(await service.getVisible(account.id.value, 'user-1')).toBe(account);
    });

    it("hides another owner's account (returns null)", async () => {
      const account = Account.openUser(usd(), 'user-2', fixedNow);
      const { repository } = buildRepo({
        findById: jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(account),
      });
      const service = buildService(repository, buildBalances().repository);

      expect(await service.getVisible(account.id.value, 'user-1')).toBeNull();
    });

    it('exposes a system account to any caller', async () => {
      const world = systemAccount();
      const { repository } = buildRepo({
        findById: jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(world),
      });
      const service = buildService(repository, buildBalances().repository);

      expect(await service.getVisible(world.id.value, 'user-1')).toBe(world);
    });

    it('returns null when no account matches', async () => {
      const { repository } = buildRepo();
      const service = buildService(repository, buildBalances().repository);

      expect(await service.getVisible(AccountId.generate().value, 'user-1')).toBeNull();
    });
  });

  describe('listVisible', () => {
    it('delegates to the owner-scoped repository query', async () => {
      const accounts = [Account.openUser(usd(), 'user-1', fixedNow)];
      const { repository, listVisibleTo } = buildRepo({
        listVisibleTo: jest.fn<Promise<Account[]>, [string, Tx?]>().mockResolvedValue(accounts),
      });
      const service = buildService(repository, buildBalances().repository);

      expect(await service.listVisible('user-1')).toBe(accounts);
      expect(listVisibleTo).toHaveBeenCalledWith('user-1');
    });
  });
});
