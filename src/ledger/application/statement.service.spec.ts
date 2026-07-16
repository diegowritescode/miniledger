import { Currency } from '../../shared/kernel/currency';
import { type Tx } from '../../shared/persistence/unit-of-work';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import { type AccountsRepository } from '../domain/ports/accounts-repository';
import {
  type StatementEntry,
  type StatementRepository,
} from '../domain/ports/statement-repository';
import { StatementService } from './statement.service';

const at = new Date('2026-07-07T07:00:00.000Z');

const usd = (): Currency => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

const userAccount = (id: AccountId, ownerId: string): Account =>
  Account.reconstitute({
    id,
    type: 'user',
    currency: usd(),
    overdraftFloor: 0n,
    handle: null,
    ownerId,
    createdAt: at,
  });

const systemAccount = (id: AccountId): Account =>
  Account.reconstitute({
    id,
    type: 'system',
    currency: usd(),
    overdraftFloor: null,
    handle: '@world',
    ownerId: null,
    createdAt: at,
  });

const entry = (seq: number): StatementEntry => ({
  seq,
  transactionId: `tx-${seq}`,
  amount: BigInt(seq * 10),
  balanceAfter: BigInt(seq * 10),
  createdAt: at,
});

const build = (account: Account | null, entries: StatementEntry[]) => {
  const findById = jest.fn<Promise<Account | null>, [AccountId, Tx?]>().mockResolvedValue(account);
  const accounts = { findById } as unknown as AccountsRepository;
  const page = jest
    .fn<Promise<StatementEntry[]>, [AccountId, number, number | null, Tx?]>()
    .mockResolvedValue(entries);
  const statements: StatementRepository = { page };
  return { service: new StatementService(accounts, statements), page };
};

describe('StatementService', () => {
  it('returns a page and a next cursor when more rows exist', async () => {
    const id = AccountId.generate();
    const { service, page } = build(userAccount(id, 'user-1'), [entry(1), entry(2), entry(3)]);

    const statement = await service.forAccount(id.value, 'user-1', 2, null);

    expect(statement).not.toBeNull();
    expect(statement?.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(statement?.nextCursor).toBe(2);
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ value: id.value }), 3, null);
  });

  it('returns no next cursor on the last page', async () => {
    const id = AccountId.generate();
    const { service } = build(userAccount(id, 'user-1'), [entry(4), entry(5)]);

    const statement = await service.forAccount(id.value, 'user-1', 2, 3);

    expect(statement?.entries.map((e) => e.seq)).toEqual([4, 5]);
    expect(statement?.nextCursor).toBeNull();
  });

  it("hides another owner's account", async () => {
    const id = AccountId.generate();
    const { service } = build(userAccount(id, 'user-2'), [entry(1)]);

    expect(await service.forAccount(id.value, 'user-1', 50, null)).toBeNull();
  });

  it('exposes a system account to any caller', async () => {
    const id = AccountId.generate();
    const { service } = build(systemAccount(id), [entry(1)]);

    expect(await service.forAccount(id.value, 'user-1', 50, null)).not.toBeNull();
  });

  it('returns null for an unknown account', async () => {
    const { service } = build(null, []);

    expect(await service.forAccount(AccountId.generate().value, 'user-1', 50, null)).toBeNull();
  });
});
