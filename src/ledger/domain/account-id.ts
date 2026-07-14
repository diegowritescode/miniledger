import { randomUUID } from 'node:crypto';

export class AccountId {
  private constructor(readonly value: string) {}

  static generate(): AccountId {
    return new AccountId(randomUUID());
  }

  static fromString(value: string): AccountId {
    return new AccountId(value);
  }

  equals(other: AccountId): boolean {
    return this.value === other.value;
  }
}
