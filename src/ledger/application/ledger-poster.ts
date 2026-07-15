import { Inject, Injectable } from '@nestjs/common';
import { type Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { type Tx } from '../../shared/persistence/unit-of-work';
import { type Account } from '../domain/account';
import { AccountId } from '../domain/account-id';
import { hashPosting } from '../domain/hash-chain';
import { type JournalTransaction } from '../domain/journal-transaction';
import { isSufficient } from '../domain/overdraft';
import {
  ACCOUNT_BALANCES_REPOSITORY,
  type AccountBalancesRepository,
} from '../domain/ports/account-balances-repository';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from '../domain/ports/accounts-repository';
import {
  JOURNAL_TRANSACTIONS_REPOSITORY,
  type JournalTransactionsRepository,
  type PostingLine,
} from '../domain/ports/journal-transactions-repository';
import { OUTBOX_REPOSITORY, type OutboxRepository } from '../domain/ports/outbox-repository';

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

export type PostingError =
  'unknown_account' | 'account_currency_mismatch' | 'not_account_owner' | 'insufficient_funds';

export interface PostOptions {
  readonly requireOwner: string | null;
  readonly eventType: string;
  readonly reversesTransactionId?: string;
}

export class LedgerPostingFailure extends Error {
  constructor(readonly code: PostingError) {
    super(code);
  }
}

@Injectable()
export class LedgerPoster {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    @Inject(ACCOUNT_BALANCES_REPOSITORY) private readonly balances: AccountBalancesRepository,
    @Inject(JOURNAL_TRANSACTIONS_REPOSITORY)
    private readonly journals: JournalTransactionsRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async post(
    journal: JournalTransaction,
    currency: Currency,
    options: PostOptions,
    tx: Tx,
  ): Promise<TransferReceipt> {
    const involved = journal.postings.map((posting) => posting.accountId);
    const accounts = await Promise.all(involved.map((id) => this.accounts.findById(id, tx)));

    const floors = new Map<string, bigint | null>();
    const byId = new Map<string, Account>();
    for (const account of accounts) {
      if (!account) throw new LedgerPostingFailure('unknown_account');
      if (!account.currency.equals(currency))
        throw new LedgerPostingFailure('account_currency_mismatch');
      floors.set(account.id.value, account.overdraftFloor);
      byId.set(account.id.value, account);
    }

    if (options.requireOwner !== null) {
      const owner = options.requireOwner;
      for (const posting of journal.postings) {
        if (!posting.amount.isNegative()) continue;
        const source = byId.get(posting.accountId.value);
        if (source && !source.isSystem() && !source.isOwnedBy(owner)) {
          throw new LedgerPostingFailure('not_account_owner');
        }
      }
    }

    const locked = await this.balances.lockForUpdate(involved, tx);
    const running = new Map(locked);
    const lines: PostingLine[] = [];
    for (const posting of journal.postings) {
      const key = posting.accountId.value;
      const state = running.get(key);
      if (state === undefined) throw new LedgerPostingFailure('unknown_account');
      if (
        !isSufficient(Money.of(state.balance, currency), posting.amount, floors.get(key) ?? null)
      ) {
        throw new LedgerPostingFailure('insufficient_funds');
      }
      const balanceAfter = state.balance + posting.amount.amount;
      const hash = hashPosting(state.chainHash, {
        transactionId: journal.id.value,
        accountId: key,
        amount: posting.amount.amount,
        balanceAfter,
      });
      lines.push({ balanceAfter, prevHash: state.chainHash, hash });
      running.set(key, { balance: balanceAfter, chainHash: hash });
    }

    await this.journals.append(journal, lines, tx, options.reversesTransactionId);
    for (const [key, state] of running) {
      await this.balances.updateBalance(
        AccountId.fromString(key),
        state.balance,
        state.chainHash,
        tx,
      );
    }

    const receipt: TransferReceipt = {
      id: journal.id.value,
      currency: currency.code,
      postings: journal.postings.map((posting, index) => ({
        accountId: posting.accountId.value,
        amount: posting.amount.amount.toString(),
        balanceAfter: lines[index]!.balanceAfter.toString(),
      })),
    };

    await this.outbox.append({ type: options.eventType, payload: receipt }, tx);
    return receipt;
  }
}
