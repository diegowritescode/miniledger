import { Inject, Injectable } from '@nestjs/common';
import { err, ok, type Result } from '../../shared/result';
import { AccountId } from '../domain/account-id';
import { verifyChain } from '../domain/hash-chain';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from '../domain/ports/accounts-repository';
import { AUDIT_REPOSITORY, type AuditRepository } from '../domain/ports/audit-repository';

export type VerifyAccountError = 'unknown_account';

export interface AccountAuditReport {
  readonly accountId: string;
  readonly postingCount: number;
  readonly balance: bigint;
  readonly chainValid: boolean;
  readonly headMatches: boolean;
  readonly reconciled: boolean;
  readonly brokenAtSeq: number | null;
}

export interface CurrencyTotal {
  readonly currency: string;
  readonly total: bigint;
}

export interface ConservationReport {
  readonly conserved: boolean;
  readonly byCurrency: CurrencyTotal[];
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async verifyAccount(id: string): Promise<Result<AccountAuditReport, VerifyAccountError>> {
    const accountId = AccountId.fromString(id);
    const account = await this.accounts.findById(accountId);
    if (!account) return err('unknown_account');

    const postings = await this.audit.postingsForAccount(accountId);
    const state = await this.audit.accountState(accountId);
    const balance = state?.balance ?? 0n;
    const chainHash = state?.chainHash ?? null;

    const verification = verifyChain(
      postings.map((posting) => ({
        prevHash: posting.prevHash,
        hash: posting.hash,
        content: {
          transactionId: posting.transactionId,
          accountId: posting.accountId,
          amount: posting.amount,
          balanceAfter: posting.balanceAfter,
        },
      })),
    );

    const head = postings.at(-1)?.hash ?? null;
    const summed = postings.reduce((total, posting) => total + posting.amount, 0n);
    const lastBalanceAfter = postings.at(-1)?.balanceAfter ?? 0n;

    const brokenAtSeq =
      verification.brokenAtIndex === null
        ? null
        : (postings[verification.brokenAtIndex]?.seq ?? null);

    return ok({
      accountId: account.id.value,
      postingCount: postings.length,
      balance,
      chainValid: verification.valid,
      headMatches: head === chainHash,
      reconciled: summed === balance && balance === lastBalanceAfter,
      brokenAtSeq,
    });
  }

  async verifyConservation(): Promise<ConservationReport> {
    const totals = await this.audit.conservationByCurrency();
    const byCurrency = [...totals.entries()]
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return { conserved: byCurrency.every((entry) => entry.total === 0n), byCurrency };
  }
}
