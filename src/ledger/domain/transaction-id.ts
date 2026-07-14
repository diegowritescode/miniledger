import { randomUUID } from 'node:crypto';

export class TransactionId {
  private constructor(readonly value: string) {}

  static generate(): TransactionId {
    return new TransactionId(randomUUID());
  }

  static fromString(value: string): TransactionId {
    return new TransactionId(value);
  }

  equals(other: TransactionId): boolean {
    return this.value === other.value;
  }
}
