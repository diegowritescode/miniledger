import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { UNIT_OF_WORK, type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { err, ok, type Result } from '../../shared/result';
import { AccountId } from '../domain/account-id';
import {
  ACCOUNT_BALANCES_REPOSITORY,
  type AccountBalancesRepository,
} from '../domain/ports/account-balances-repository';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from '../domain/ports/accounts-repository';
import {
  JOURNAL_TRANSACTIONS_REPOSITORY,
  type JournalTransactionsRepository,
} from '../domain/ports/journal-transactions-repository';
import { isSufficient } from '../domain/overdraft';
import { JournalTransaction } from '../domain/journal-transaction';

export type TransferError =
  | 'unknown_currency'
  | 'non_positive_amount'
  | 'same_account'
  | 'unknown_account'
  | 'account_currency_mismatch'
  | 'insufficient_funds';

export interface TransferInput {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly currency: string;
}

export interface TransferResult {
  readonly transaction: JournalTransaction;
  readonly balanceAfter: readonly bigint[];
}

@Injectable()
export class TransferService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    @Inject(ACCOUNT_BALANCES_REPOSITORY) private readonly balances: AccountBalancesRepository,
    @Inject(JOURNAL_TRANSACTIONS_REPOSITORY)
    private readonly journals: JournalTransactionsRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async transfer(input: TransferInput): Promise<Result<TransferResult, TransferError>> {
    const currency = Currency.of(input.currency);
    if (!currency.ok) return err('unknown_currency');

    const amount = this.parseAmount(input.amount);
    if (amount === null || amount <= 0n) return err('non_positive_amount');

    const fromId = AccountId.fromString(input.from);
    const toId = AccountId.fromString(input.to);
    if (fromId.value === toId.value) return err('same_account');

    const built = JournalTransaction.transfer(fromId, toId, Money.of(amount, currency.value));
    if (!built.ok) return err('non_positive_amount');
    const journal = built.value;

    return this.uow.withTransaction((tx) => this.post(journal, currency.value, tx));
  }

  private async post(
    journal: JournalTransaction,
    currency: Currency,
    tx: Tx,
  ): Promise<Result<TransferResult, TransferError>> {
    const involved = journal.postings.map((posting) => posting.accountId);
    const accounts = await Promise.all(involved.map((id) => this.accounts.findById(id, tx)));
    if (accounts.some((account) => account === null)) return err('unknown_account');

    const floors = new Map<string, bigint | null>();
    for (const account of accounts) {
      if (!account) return err('unknown_account');
      if (!account.currency.equals(currency)) return err('account_currency_mismatch');
      floors.set(account.id.value, account.overdraftFloor);
    }

    const locked = await this.balances.lockForUpdate(involved, tx);

    const running = new Map(locked);
    const balanceAfter: bigint[] = [];
    for (const posting of journal.postings) {
      const key = posting.accountId.value;
      const current = running.get(key);
      if (current === undefined) return err('unknown_account');
      const currentMoney = Money.of(current, currency);
      if (!isSufficient(currentMoney, posting.amount, floors.get(key) ?? null)) {
        return err('insufficient_funds');
      }
      const next = current + posting.amount.amount;
      running.set(key, next);
      balanceAfter.push(next);
    }

    await this.journals.append(journal, balanceAfter, tx);
    for (const [key, balance] of running) {
      await this.balances.updateBalance(AccountId.fromString(key), balance, tx);
    }

    return ok({ transaction: journal, balanceAfter });
  }

  private parseAmount(raw: string): bigint | null {
    if (!/^\d+$/.test(raw)) return null;
    return BigInt(raw);
  }
}
