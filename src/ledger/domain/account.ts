import { type Currency } from '../../shared/kernel/currency';
import { AccountId } from './account-id';

export type AccountType = 'user' | 'system';

export interface AccountProps {
  readonly id: AccountId;
  readonly type: AccountType;
  readonly currency: Currency;
  readonly overdraftFloor: bigint | null;
  readonly handle: string | null;
  readonly ownerId: string | null;
  readonly createdAt: Date;
}

export class Account {
  private constructor(
    readonly id: AccountId,
    readonly type: AccountType,
    readonly currency: Currency,
    readonly overdraftFloor: bigint | null,
    readonly handle: string | null,
    readonly ownerId: string | null,
    readonly createdAt: Date,
  ) {}

  static openUser(currency: Currency, ownerId: string, createdAt: Date): Account {
    return new Account(AccountId.generate(), 'user', currency, 0n, null, ownerId, createdAt);
  }

  static reconstitute(props: AccountProps): Account {
    return new Account(
      props.id,
      props.type,
      props.currency,
      props.overdraftFloor,
      props.handle,
      props.ownerId,
      props.createdAt,
    );
  }

  isSystem(): boolean {
    return this.type === 'system';
  }

  isOverdraftExempt(): boolean {
    return this.overdraftFloor === null;
  }

  isOwnedBy(subject: string): boolean {
    return this.ownerId === subject;
  }
}
