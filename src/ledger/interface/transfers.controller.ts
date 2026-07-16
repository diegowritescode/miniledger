import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@diegowritescode/accesscore-sdk';
import { AccessTokenGuard } from '../../access/access-token.guard';
import { CurrentPrincipal } from '../../access/principal.decorator';
import { type Principal } from '../../access/principal';
import { openApiSchema } from '../../shared/http/openapi-schema';
import { ProblemException } from '../../shared/http/problem-details';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import {
  type TransferError,
  type TransferReceipt,
  TransferService,
} from '../application/transfer.service';
import { transferSchema, type TransferDto } from './transfer.dto';

const PROBLEMS: Record<TransferError, { status: number; title: string }> = {
  unknown_currency: { status: 422, title: 'Unknown currency' },
  non_positive_amount: { status: 422, title: 'Amount must be a positive integer' },
  same_account: { status: 422, title: 'Source and destination must differ' },
  unknown_account: { status: 404, title: 'Account not found' },
  account_currency_mismatch: { status: 422, title: 'Account currency does not match the transfer' },
  not_account_owner: { status: 403, title: 'You do not own the source account' },
  insufficient_funds: { status: 422, title: 'Insufficient funds' },
  idempotency_conflict: { status: 409, title: 'Idempotency key reused for a different request' },
};

@ApiTags('transfers')
@ApiBearerAuth('access-token')
@Controller('transfers')
@UseGuards(AccessTokenGuard)
export class TransfersController {
  constructor(private readonly transfers: TransferService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Move money between accounts (idempotent via Idempotency-Key)' })
  @ApiBody({ schema: openApiSchema(transferSchema) })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Makes a retried transfer a no-op.',
  })
  @RequirePermission('ledger.transfer', () => ({ type: 'ledger', id: 'miniledger' }))
  async create(
    @Body(new ZodValidationPipe(transferSchema)) body: TransferDto,
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TransferReceipt> {
    const result = await this.transfers.transfer({
      ...body,
      ownerId: principal.subject,
      idempotencyKey: idempotencyKey || undefined,
    });
    if (!result.ok) {
      const problem = PROBLEMS[result.error];
      throw new ProblemException({
        type: 'about:blank',
        title: problem.title,
        status: problem.status,
        detail: result.error,
      });
    }
    return result.value;
  }
}
