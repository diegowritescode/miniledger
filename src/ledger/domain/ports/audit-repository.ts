import { type Tx } from '../../../shared/persistence/unit-of-work';
import { type AccountId } from '../account-id';

export interface AuditPosting {
  readonly seq: number;
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: bigint;
  readonly balanceAfter: bigint;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface AuditAccountState {
  readonly balance: bigint;
  readonly chainHash: string | null;
}

export interface AuditRepository {
  postingsForAccount(accountId: AccountId, tx?: Tx): Promise<AuditPosting[]>;
  accountState(accountId: AccountId, tx?: Tx): Promise<AuditAccountState | null>;
  conservationByCurrency(tx?: Tx): Promise<Map<string, bigint>>;
}

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
