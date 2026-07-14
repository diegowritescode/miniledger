import { type Money } from '../../shared/kernel/money';
import { type AccountId } from './account-id';

export class Posting {
  private constructor(
    readonly accountId: AccountId,
    readonly amount: Money,
  ) {}

  static of(accountId: AccountId, amount: Money): Posting {
    return new Posting(accountId, amount);
  }
}
