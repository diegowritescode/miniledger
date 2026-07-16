import { randomUUID } from 'node:crypto';
import { Currency } from '../../shared/kernel/currency';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import { hashPosting } from '../domain/hash-chain';
import { type AccountsRepository } from '../domain/ports/accounts-repository';
import {
  type AuditAccountState,
  type AuditPosting,
  type AuditRepository,
} from '../domain/ports/audit-repository';
import { AuditService } from './audit.service';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('USD must be supported');
  return result.value;
})();

const userAccount = (id: AccountId): Account =>
  Account.reconstitute({
    id,
    type: 'user',
    currency: USD,
    overdraftFloor: 0n,
    handle: null,
    ownerId: 'owner-1',
    createdAt: new Date('2026-06-06T06:00:00.000Z'),
  });

interface BuiltChain {
  readonly postings: AuditPosting[];
  readonly head: string | null;
  readonly balance: bigint;
}

const chainFor = (accountId: string, amounts: bigint[]): BuiltChain => {
  let prev: string | null = null;
  let balance = 0n;
  const postings: AuditPosting[] = amounts.map((amount, index) => {
    balance += amount;
    const transactionId = randomUUID();
    const content = { transactionId, accountId, amount, balanceAfter: balance };
    const hash = hashPosting(prev, content);
    const posting: AuditPosting = {
      seq: index + 1,
      transactionId,
      accountId,
      amount,
      balanceAfter: balance,
      prevHash: prev,
      hash,
    };
    prev = hash;
    return posting;
  });
  return { postings, head: prev, balance };
};

interface Options {
  account?: Account | null;
  postings?: AuditPosting[];
  state?: AuditAccountState | null;
  conservation?: Map<string, bigint>;
}

const build = (options: Options): AuditService => {
  const accounts: AccountsRepository = {
    save: jest.fn(),
    findByHandle: jest.fn(),
    listVisibleTo: jest.fn(),
    findById: jest.fn().mockResolvedValue(options.account ?? null),
  };
  const audit: AuditRepository = {
    postingsForAccount: jest.fn().mockResolvedValue(options.postings ?? []),
    accountState: jest.fn().mockResolvedValue(options.state ?? null),
    conservationByCurrency: jest.fn().mockResolvedValue(options.conservation ?? new Map()),
  };
  return new AuditService(accounts, audit);
};

describe('AuditService', () => {
  describe('verifyAccount', () => {
    it('returns unknown_account when the account does not exist', async () => {
      const service = build({ account: null });

      const result = await service.verifyAccount(AccountId.generate().value);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('unknown_account');
    });

    it('reports a valid, head-matching, reconciled account', async () => {
      const id = AccountId.generate();
      const { postings, head, balance } = chainFor(id.value, [1000n, -300n, -200n]);
      const service = build({
        account: userAccount(id),
        postings,
        state: { balance, chainHash: head },
      });

      const result = await service.verifyAccount(id.value);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({
        accountId: id.value,
        postingCount: 3,
        balance: 500n,
        chainValid: true,
        headMatches: true,
        reconciled: true,
        brokenAtSeq: null,
      });
    });

    it('treats an account with no postings as trivially valid and reconciled', async () => {
      const id = AccountId.generate();
      const service = build({
        account: userAccount(id),
        postings: [],
        state: { balance: 0n, chainHash: null },
      });

      const result = await service.verifyAccount(id.value);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.postingCount).toBe(0);
      expect(result.value.chainValid).toBe(true);
      expect(result.value.headMatches).toBe(true);
      expect(result.value.reconciled).toBe(true);
      expect(result.value.brokenAtSeq).toBeNull();
      expect(result.value.balance).toBe(0n);
    });

    it('defaults balance and head when the account has no balance row', async () => {
      const id = AccountId.generate();
      const service = build({ account: userAccount(id), postings: [], state: null });

      const result = await service.verifyAccount(id.value);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.balance).toBe(0n);
      expect(result.value.headMatches).toBe(true);
      expect(result.value.reconciled).toBe(true);
    });

    it('flags a tampered amount at the right seq and marks it unreconciled', async () => {
      const id = AccountId.generate();
      const { postings, head, balance } = chainFor(id.value, [1000n, -300n]);
      const tampered = postings.map((posting, index) =>
        index === 1 ? { ...posting, amount: posting.amount - 1n } : posting,
      );
      const service = build({
        account: userAccount(id),
        postings: tampered,
        state: { balance, chainHash: head },
      });

      const result = await service.verifyAccount(id.value);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.chainValid).toBe(false);
      expect(result.value.brokenAtSeq).toBe(tampered[1]!.seq);
      expect(result.value.headMatches).toBe(true);
      expect(result.value.reconciled).toBe(false);
    });
  });

  describe('verifyConservation', () => {
    it('reports conserved and sorts totals by currency when every total is zero', async () => {
      const service = build({
        conservation: new Map<string, bigint>([
          ['USD', 0n],
          ['EUR', 0n],
        ]),
      });

      const report = await service.verifyConservation();

      expect(report.conserved).toBe(true);
      expect(report.byCurrency).toEqual([
        { currency: 'EUR', total: 0n },
        { currency: 'USD', total: 0n },
      ]);
    });

    it('reports not conserved when any currency total is non-zero', async () => {
      const service = build({ conservation: new Map<string, bigint>([['USD', 5n]]) });

      const report = await service.verifyConservation();

      expect(report.conserved).toBe(false);
      expect(report.byCurrency).toEqual([{ currency: 'USD', total: 5n }]);
    });
  });
});
