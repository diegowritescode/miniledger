import { Currency } from '../../shared/kernel/currency';
import { Account } from './account';
import { AccountId } from './account-id';

const usd = (): Currency => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

describe('Account', () => {
  describe('openUser', () => {
    it('opens a user account with a generated id, zero floor and no handle', () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const account = Account.openUser(usd(), createdAt);

      expect(account.id).toBeInstanceOf(AccountId);
      expect(account.id.value).toHaveLength(36);
      expect(account.type).toBe('user');
      expect(account.currency.code).toBe('USD');
      expect(account.overdraftFloor).toBe(0n);
      expect(account.handle).toBeNull();
      expect(account.createdAt).toBe(createdAt);
    });

    it('generates a distinct id for each account', () => {
      const a = Account.openUser(usd(), new Date());
      const b = Account.openUser(usd(), new Date());

      expect(a.id.equals(b.id)).toBe(false);
    });

    it('is not a system account and is not overdraft-exempt', () => {
      const account = Account.openUser(usd(), new Date());

      expect(account.isSystem()).toBe(false);
      expect(account.isOverdraftExempt()).toBe(false);
    });
  });

  describe('reconstitute', () => {
    it('rebuilds an account from stored props', () => {
      const id = AccountId.generate();
      const createdAt = new Date('2026-02-02T12:00:00.000Z');
      const account = Account.reconstitute({
        id,
        type: 'user',
        currency: usd(),
        overdraftFloor: 0n,
        handle: null,
        createdAt,
      });

      expect(account.id.equals(id)).toBe(true);
      expect(account.type).toBe('user');
      expect(account.overdraftFloor).toBe(0n);
      expect(account.createdAt).toBe(createdAt);
    });

    it('models the @world system account as overdraft-exempt with a handle', () => {
      const account = Account.reconstitute({
        id: AccountId.generate(),
        type: 'system',
        currency: usd(),
        overdraftFloor: null,
        handle: '@world',
        createdAt: new Date(),
      });

      expect(account.isSystem()).toBe(true);
      expect(account.isOverdraftExempt()).toBe(true);
      expect(account.handle).toBe('@world');
    });
  });
});
