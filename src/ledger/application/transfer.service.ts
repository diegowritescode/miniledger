import { createHash } from 'node:crypto';
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
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '../domain/ports/idempotency-repository';
import {
  JOURNAL_TRANSACTIONS_REPOSITORY,
  type JournalTransactionsRepository,
} from '../domain/ports/journal-transactions-repository';
import { JournalTransaction } from '../domain/journal-transaction';
import { isSufficient } from '../domain/overdraft';

export type TransferError =
  | 'unknown_currency'
  | 'non_positive_amount'
  | 'same_account'
  | 'unknown_account'
  | 'account_currency_mismatch'
  | 'insufficient_funds'
  | 'idempotency_conflict';

export interface TransferInput {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly currency: string;
  readonly idempotencyKey?: string;
}

export interface PostingReceipt {
  readonly accountId: string;
  readonly amount: string;
  readonly balanceAfter: string;
}

export interface TransferReceipt {
  readonly id: string;
  readonly currency: string;
  readonly postings: readonly PostingReceipt[];
}

class TransferFailure extends Error {
  constructor(readonly code: TransferError) {
    super(code);
  }
}

@Injectable()
export class TransferService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    @Inject(ACCOUNT_BALANCES_REPOSITORY) private readonly balances: AccountBalancesRepository,
    @Inject(JOURNAL_TRANSACTIONS_REPOSITORY)
    private readonly journals: JournalTransactionsRepository,
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly idempotency: IdempotencyRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async transfer(input: TransferInput): Promise<Result<TransferReceipt, TransferError>> {
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
    const fingerprint = this.fingerprint(input);

    try {
      const receipt = await this.uow.withTransaction((tx) =>
        this.run(journal, currency.value, input.idempotencyKey, fingerprint, tx),
      );
      return ok(receipt);
    } catch (error) {
      if (error instanceof TransferFailure) return err(error.code);
      throw error;
    }
  }

  private async run(
    journal: JournalTransaction,
    currency: Currency,
    idempotencyKey: string | undefined,
    fingerprint: string,
    tx: Tx,
  ): Promise<TransferReceipt> {
    if (idempotencyKey) {
      const claim = await this.idempotency.claim(idempotencyKey, fingerprint, tx);
      if (!claim.owned) {
        if (claim.fingerprint !== fingerprint) throw new TransferFailure('idempotency_conflict');
        return claim.response as TransferReceipt;
      }
    }

    const receipt = await this.execute(journal, currency, tx);

    if (idempotencyKey) {
      await this.idempotency.complete(idempotencyKey, journal.id.value, receipt, tx);
    }
    return receipt;
  }

  private async execute(
    journal: JournalTransaction,
    currency: Currency,
    tx: Tx,
  ): Promise<TransferReceipt> {
    const involved = journal.postings.map((posting) => posting.accountId);
    const accounts = await Promise.all(involved.map((id) => this.accounts.findById(id, tx)));

    const floors = new Map<string, bigint | null>();
    for (const account of accounts) {
      if (!account) throw new TransferFailure('unknown_account');
      if (!account.currency.equals(currency))
        throw new TransferFailure('account_currency_mismatch');
      floors.set(account.id.value, account.overdraftFloor);
    }

    const locked = await this.balances.lockForUpdate(involved, tx);
    const running = new Map(locked);
    const balanceAfter: bigint[] = [];
    for (const posting of journal.postings) {
      const key = posting.accountId.value;
      const current = running.get(key);
      if (current === undefined) throw new TransferFailure('unknown_account');
      if (!isSufficient(Money.of(current, currency), posting.amount, floors.get(key) ?? null)) {
        throw new TransferFailure('insufficient_funds');
      }
      const next = current + posting.amount.amount;
      running.set(key, next);
      balanceAfter.push(next);
    }

    await this.journals.append(journal, balanceAfter, tx);
    for (const [key, balance] of running) {
      await this.balances.updateBalance(AccountId.fromString(key), balance, tx);
    }

    return {
      id: journal.id.value,
      currency: currency.code,
      postings: journal.postings.map((posting, index) => ({
        accountId: posting.accountId.value,
        amount: posting.amount.amount.toString(),
        balanceAfter: balanceAfter[index]!.toString(),
      })),
    };
  }

  private parseAmount(raw: string): bigint | null {
    if (!/^\d+$/.test(raw)) return null;
    return BigInt(raw);
  }

  private fingerprint(input: TransferInput): string {
    const canonical = `${input.from}|${input.to}|${input.amount}|${input.currency}`;
    return createHash('sha256').update(canonical).digest('hex');
  }
}
