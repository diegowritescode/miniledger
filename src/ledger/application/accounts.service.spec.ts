import { type Clock } from '../../shared/kernel/clock';
import { Currency } from '../../shared/kernel/currency';
import { type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import { type AccountBalancesRepository } from '../domain/ports/account-balances-repository';
import { type AccountsRepository } from '../domain/ports/accounts-repository';
import { AccountsService } from './accounts.service';

const fixedNow = new Date('2026-03-03T09:00:00.000Z');

const clock: Clock = { now: () => fixedNow };

const usd = (): Currency => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

interface RepoMocks {
  readonly repository: AccountsRepository;
  readonly save: jest.Mock<Promise<void>, [Account, Tx?]>;
  readonly findById: jest.Mock<Promise<Account | null>, [AccountId, Tx?]>;
  readonly list: jest.Mock<Promise<Account[]>, [Tx?]>;
}

const buildRepo = (
  overrides: Partial<Pick<RepoMocks, 'save' | 'findById' | 'list'>> = {},
): RepoMocks => {
  const save = overrides.save ?? jest.fn<Promise<void>, [Account, Tx?]>().mockResolvedValue();
  const findById =
    overrides.findById ??
    jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(null);
  const list = overrides.list ?? jest.fn<Promise<Account[]>, [Tx?]>().mockResolvedValue([]);
  const findByHandle = jest.fn().mockResolvedValue(null);
  const repository: AccountsRepository = { save, findById, findByHandle, list };
  return { repository, save, findById, list };
};

interface BalancesMocks {
  readonly repository: AccountBalancesRepository;
  readonly initialize: jest.Mock<Promise<void>, [AccountId, Tx?]>;
}

const buildBalances = (): BalancesMocks => {
  const initialize = jest.fn<Promise<void>, [AccountId, Tx?]>().mockResolvedValue();
  const find = jest.fn<Promise<bigint | null>, [AccountId, Tx?]>().mockResolvedValue(null);
  const updateBalance = jest.fn<Promise<void>, [AccountId, bigint, Tx?]>().mockResolvedValue();
  const repository: AccountBalancesRepository = { initialize, find, updateBalance };
  return { repository, initialize };
};

const passthroughUow: UnitOfWork = {
  withTransaction: (work) => work({ executor: {} }),
};

describe('AccountsService', () => {
  describe('open', () => {
    it('opens a user account and persists it inside a transaction', async () => {
      const { repository, save } = buildRepo();
      const balances = buildBalances();
      const service = new AccountsService(repository, balances.repository, passthroughUow, clock);

      const result = await service.open({ currency: 'USD' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe('user');
      expect(result.value.currency.code).toBe('USD');
      expect(result.value.createdAt).toBe(fixedNow);
      expect(save).toHaveBeenCalledTimes(1);
      const [savedAccount, tx] = save.mock.calls[0] ?? [];
      expect(savedAccount).toBeInstanceOf(Account);
      expect(tx).toBeDefined();
    });

    it('initializes the balance row once, in the same transaction as the account', async () => {
      const { repository, save } = buildRepo();
      const balances = buildBalances();
      const service = new AccountsService(repository, balances.repository, passthroughUow, clock);

      const result = await service.open({ currency: 'USD' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(balances.initialize).toHaveBeenCalledTimes(1);
      const [accountId, initTx] = balances.initialize.mock.calls[0] ?? [];
      const [savedAccount, saveTx] = save.mock.calls[0] ?? [];
      expect(accountId?.value).toBe(result.value.id.value);
      expect(savedAccount).toBeDefined();
      expect(initTx).toBe(saveTx);
    });

    it('rejects an unknown currency without touching the repository', async () => {
      const { repository, save } = buildRepo();
      const balances = buildBalances();
      const service = new AccountsService(repository, balances.repository, passthroughUow, clock);

      const result = await service.open({ currency: 'ZZZ' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('unknown_currency');
      expect(save).not.toHaveBeenCalled();
      expect(balances.initialize).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('resolves an account by its id', async () => {
      const account = Account.openUser(usd(), fixedNow);
      const { repository, findById } = buildRepo({
        findById: jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(account),
      });
      const service = new AccountsService(
        repository,
        buildBalances().repository,
        passthroughUow,
        clock,
      );

      const found = await service.getById(account.id.value);

      expect(found).toBe(account);
      const [id] = findById.mock.calls[0] ?? [];
      expect(id?.value).toBe(account.id.value);
    });

    it('returns null when no account matches', async () => {
      const { repository } = buildRepo();
      const service = new AccountsService(
        repository,
        buildBalances().repository,
        passthroughUow,
        clock,
      );

      expect(await service.getById(AccountId.generate().value)).toBeNull();
    });
  });

  describe('list', () => {
    it('delegates to the repository', async () => {
      const accounts = [Account.openUser(usd(), fixedNow)];
      const { repository } = buildRepo({
        list: jest.fn<Promise<Account[]>, [Tx?]>().mockResolvedValue(accounts),
      });
      const service = new AccountsService(
        repository,
        buildBalances().repository,
        passthroughUow,
        clock,
      );

      expect(await service.list()).toBe(accounts);
    });
  });
});
