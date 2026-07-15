import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '@diegowritescode/accesscore-sdk';
import { AccessTokenGuard } from '../../access/access-token.guard';
import { ProblemException } from '../../shared/http/problem-details';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { type ReverseError, ReverseService } from '../application/reverse.service';
import { type TransferReceipt } from '../application/ledger-poster';
import { reversalSchema, type ReversalDto } from './reversal.dto';

const PROBLEMS: Record<ReverseError, { status: number; title: string }> = {
  unknown_transaction: { status: 404, title: 'Transaction not found' },
  already_reversed: { status: 409, title: 'Transaction already reversed' },
  insufficient_funds: { status: 422, title: 'Insufficient funds to reverse' },
};

@Controller('reversals')
@UseGuards(AccessTokenGuard)
export class ReversalsController {
  constructor(private readonly reversals: ReverseService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('ledger.reverse', () => ({ type: 'ledger', id: 'miniledger' }))
  async create(
    @Body(new ZodValidationPipe(reversalSchema)) body: ReversalDto,
  ): Promise<TransferReceipt> {
    const result = await this.reversals.reverse(body.transactionId);
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
