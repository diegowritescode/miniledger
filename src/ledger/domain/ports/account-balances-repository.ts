import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../account-id';

export interface AccountBalancesRepository {
  initialize(accountId: AccountId, tx?: Tx): Promise<void>;
  find(accountId: AccountId, tx?: Tx): Promise<bigint | null>;
  updateBalance(accountId: AccountId, balance: bigint, tx?: Tx): Promise<void>;
}

export const ACCOUNT_BALANCES_REPOSITORY = Symbol('ACCOUNT_BALANCES_REPOSITORY');
