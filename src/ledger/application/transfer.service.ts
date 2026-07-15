import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { UNIT_OF_WORK, type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { err, ok, type Result } from '../../shared/result';
import { AccountId } from '../domain/account-id';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '../domain/ports/idempotency-repository';
import { JournalTransaction } from '../domain/journal-transaction';
import { LedgerPoster, LedgerPostingFailure, type TransferReceipt } from './ledger-poster';

export type { PostingReceipt, TransferReceipt } from './ledger-poster';

export type TransferError =
  | 'unknown_currency'
  | 'non_positive_amount'
  | 'same_account'
  | 'unknown_account'
  | 'account_currency_mismatch'
  | 'not_account_owner'
  | 'insufficient_funds'
  | 'idempotency_conflict';

export interface TransferInput {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly currency: string;
  readonly ownerId: string;
  readonly idempotencyKey?: string;
}

class TransferFailure extends Error {
  constructor(readonly code: TransferError) {
    super(code);
  }
}

@Injectable()
export class TransferService {
  constructor(
    private readonly poster: LedgerPoster,
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
        this.run(journal, currency.value, input.ownerId, input.idempotencyKey, fingerprint, tx),
      );
      return ok(receipt);
    } catch (error) {
      if (error instanceof TransferFailure) return err(error.code);
      if (error instanceof LedgerPostingFailure) return err(error.code);
      throw error;
    }
  }

  private async run(
    journal: JournalTransaction,
    currency: Currency,
    ownerId: string,
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

    const receipt = await this.poster.post(
      journal,
      currency,
      { requireOwner: ownerId, eventType: 'transfer.posted' },
      tx,
    );

    if (idempotencyKey) {
      await this.idempotency.complete(idempotencyKey, journal.id.value, receipt, tx);
    }
    return receipt;
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
