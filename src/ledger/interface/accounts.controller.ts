import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@diegowritescode/accesscore-sdk';
import { AccessTokenGuard } from '../../access/access-token.guard';
import { CurrentPrincipal } from '../../access/principal.decorator';
import { type Principal } from '../../access/principal';
import { openApiSchema } from '../../shared/http/openapi-schema';
import { ProblemException } from '../../shared/http/problem-details';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AccountsService } from '../application/accounts.service';
import { StatementService } from '../application/statement.service';
import { type Account } from '../domain/account';
import { openAccountSchema, type OpenAccountDto } from './open-account.dto';
import { statementQuerySchema, type StatementQuery } from './statement.dto';

interface AccountResponse {
  id: string;
  type: string;
  currency: string;
  balance: string;
  overdraftFloor: string | null;
  createdAt: string;
}

interface StatementResponse {
  entries: {
    seq: number;
    transactionId: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  }[];
  nextCursor: number | null;
}

@ApiTags('accounts')
@ApiBearerAuth('access-token')
@Controller('accounts')
@UseGuards(AccessTokenGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly statements: StatementService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Open a user account' })
  @ApiBody({ schema: openApiSchema(openAccountSchema) })
  @RequirePermission('ledger.open', () => ({ type: 'ledger', id: 'miniledger' }))
  async open(
    @Body(new ZodValidationPipe(openAccountSchema)) body: OpenAccountDto,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AccountResponse> {
    const result = await this.accounts.open({
      currency: body.currency,
      ownerId: principal.subject,
    });
    if (!result.ok) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Unknown currency',
        status: 422,
        detail: result.error,
      });
    }
    return this.toResponse(result.value, await this.accounts.balanceOf(result.value.id));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one account (owner-scoped; 404 when not visible)' })
  async getById(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AccountResponse> {
    const account = await this.accounts.getVisible(id, principal.subject);
    if (!account) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Account not found',
        status: 404,
      });
    }
    return this.toResponse(account, await this.accounts.balanceOf(account.id));
  }

  @Get()
  @ApiOperation({ summary: "List the caller's accounts plus system accounts" })
  async list(@CurrentPrincipal() principal: Principal): Promise<AccountResponse[]> {
    const accounts = await this.accounts.listVisible(principal.subject);
    return Promise.all(
      accounts.map(async (account) =>
        this.toResponse(account, await this.accounts.balanceOf(account.id)),
      ),
    );
  }

  @Get(':id/statement')
  @ApiOperation({ summary: 'Paginated posting history for an account' })
  async statement(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<StatementResponse> {
    const statement = await this.statements.forAccount(
      id,
      principal.subject,
      query.limit,
      query.cursor ?? null,
    );
    if (!statement) {
      throw new ProblemException({ type: 'about:blank', title: 'Account not found', status: 404 });
    }
    return {
      entries: statement.entries.map((entry) => ({
        seq: entry.seq,
        transactionId: entry.transactionId,
        amount: entry.amount.toString(),
        balanceAfter: entry.balanceAfter.toString(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: statement.nextCursor,
    };
  }

  private toResponse(account: Account, balance: bigint): AccountResponse {
    return {
      id: account.id.value,
      type: account.type,
      currency: account.currency.code,
      balance: balance.toString(),
      overdraftFloor: account.overdraftFloor === null ? null : account.overdraftFloor.toString(),
      createdAt: account.createdAt.toISOString(),
    };
  }
}
