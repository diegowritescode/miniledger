import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../access/access-token.guard';
import { CurrentPrincipal } from '../../access/principal.decorator';
import { type Principal } from '../../access/principal';
import { ProblemException } from '../../shared/http/problem-details';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AccountsService } from '../application/accounts.service';
import { type Account } from '../domain/account';
import { openAccountSchema, type OpenAccountDto } from './open-account.dto';

interface AccountResponse {
  id: string;
  type: string;
  currency: string;
  overdraftFloor: string | null;
  createdAt: string;
}

@Controller('accounts')
@UseGuards(AccessTokenGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @HttpCode(201)
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
    return this.toResponse(result.value);
  }

  @Get(':id')
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
    return this.toResponse(account);
  }

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<AccountResponse[]> {
    const accounts = await this.accounts.listVisible(principal.subject);
    return accounts.map((account) => this.toResponse(account));
  }

  private toResponse(account: Account): AccountResponse {
    return {
      id: account.id.value,
      type: account.type,
      currency: account.currency.code,
      overdraftFloor: account.overdraftFloor === null ? null : account.overdraftFloor.toString(),
      createdAt: account.createdAt.toISOString(),
    };
  }
}
