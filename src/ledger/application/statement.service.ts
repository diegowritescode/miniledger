import { Inject, Injectable } from '@nestjs/common';
import { AccountId } from '../domain/account-id';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from '../domain/ports/accounts-repository';
import {
  STATEMENT_REPOSITORY,
  type StatementEntry,
  type StatementRepository,
} from '../domain/ports/statement-repository';

export interface Statement {
  readonly entries: readonly StatementEntry[];
  readonly nextCursor: number | null;
}

@Injectable()
export class StatementService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    @Inject(STATEMENT_REPOSITORY) private readonly statements: StatementRepository,
  ) {}

  async forAccount(
    id: string,
    subject: string,
    limit: number,
    cursor: number | null,
  ): Promise<Statement | null> {
    const accountId = AccountId.fromString(id);
    const account = await this.accounts.findById(accountId);
    if (!account || (!account.isSystem() && !account.isOwnedBy(subject))) return null;

    const rows = await this.statements.page(accountId, limit + 1, cursor);
    const entries = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const nextCursor = hasMore ? (entries[entries.length - 1]?.seq ?? null) : null;
    return { entries, nextCursor };
  }
}
