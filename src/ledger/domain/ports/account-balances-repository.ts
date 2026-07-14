import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../account-id';

export interface LockedBalance {
  readonly balance: bigint;
  readonly chainHash: string | null;
}

export interface AccountBalancesRepository {
  initialize(accountId: AccountId, tx?: Tx): Promise<void>;
  find(accountId: AccountId, tx?: Tx): Promise<bigint | null>;
  updateBalance(
    accountId: AccountId,
    balance: bigint,
    chainHash: string | null,
    tx?: Tx,
  ): Promise<void>;
  lockForUpdate(accountIds: readonly AccountId[], tx: Tx): Promise<Map<string, LockedBalance>>;
}

export const ACCOUNT_BALANCES_REPOSITORY = Symbol('ACCOUNT_BALANCES_REPOSITORY');
