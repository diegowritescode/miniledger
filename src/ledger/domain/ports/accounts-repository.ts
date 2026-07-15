import { type Currency } from '../../../shared/kernel/currency';
import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type Account } from '../account';
import { type AccountId } from '../account-id';

export interface AccountsRepository {
  save(account: Account, tx?: Tx): Promise<void>;
  findById(id: AccountId, tx?: Tx): Promise<Account | null>;
  findByHandle(handle: string, currency: Currency, tx?: Tx): Promise<Account | null>;
  list(tx?: Tx): Promise<Account[]>;
  listVisibleTo(ownerId: string, tx?: Tx): Promise<Account[]>;
}

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');
