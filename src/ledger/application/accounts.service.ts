import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/kernel/clock';
import { Currency } from '../../shared/kernel/currency';
import { UNIT_OF_WORK, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { err, ok, type Result } from '../../shared/result';
import { Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import {
  ACCOUNT_BALANCES_REPOSITORY,
  type AccountBalancesRepository,
} from '../domain/ports/account-balances-repository';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from '../domain/ports/accounts-repository';

export type OpenAccountError = 'unknown_currency';

export interface OpenAccountInput {
  readonly currency: string;
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    @Inject(ACCOUNT_BALANCES_REPOSITORY) private readonly balances: AccountBalancesRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async open(input: OpenAccountInput): Promise<Result<Account, OpenAccountError>> {
    const currency = Currency.of(input.currency);
    if (!currency.ok) return err('unknown_currency');

    const account = Account.openUser(currency.value, this.clock.now());
    await this.uow.withTransaction(async (tx) => {
      await this.accounts.save(account, tx);
      await this.balances.initialize(account.id, tx);
    });

    return ok(account);
  }

  getById(id: string): Promise<Account | null> {
    return this.accounts.findById(AccountId.fromString(id));
  }

  list(): Promise<Account[]> {
    return this.accounts.list();
  }
}
