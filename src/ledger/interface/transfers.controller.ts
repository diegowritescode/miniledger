import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ProblemException } from '../../shared/http/problem-details';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import {
  type TransferError,
  TransferService,
  type TransferResult,
} from '../application/transfer.service';
import { transferSchema, type TransferDto } from './transfer.dto';

interface PostingResponse {
  accountId: string;
  amount: string;
  balanceAfter: string;
}

interface TransferResponse {
  id: string;
  currency: string;
  postings: PostingResponse[];
}

const PROBLEMS: Record<TransferError, { status: number; title: string }> = {
  unknown_currency: { status: 422, title: 'Unknown currency' },
  non_positive_amount: { status: 422, title: 'Amount must be a positive integer' },
  same_account: { status: 422, title: 'Source and destination must differ' },
  unknown_account: { status: 404, title: 'Account not found' },
  account_currency_mismatch: { status: 422, title: 'Account currency does not match the transfer' },
  insufficient_funds: { status: 422, title: 'Insufficient funds' },
};

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransferService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(transferSchema)) body: TransferDto,
  ): Promise<TransferResponse> {
    const result = await this.transfers.transfer(body);
    if (!result.ok) {
      const problem = PROBLEMS[result.error];
      throw new ProblemException({
        type: 'about:blank',
        title: problem.title,
        status: problem.status,
        detail: result.error,
      });
    }
    return this.toResponse(result.value);
  }

  private toResponse(result: TransferResult): TransferResponse {
    return {
      id: result.transaction.id.value,
      currency: result.transaction.currency.code,
      postings: result.transaction.postings.map((posting, index) => ({
        accountId: posting.accountId.value,
        amount: posting.amount.amount.toString(),
        balanceAfter: result.balanceAfter[index]!.toString(),
      })),
    };
  }
}
