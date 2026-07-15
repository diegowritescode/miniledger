import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RequirePermission } from '@diegowritescode/accesscore-sdk';
import { AccessTokenGuard } from '../../access/access-token.guard';
import { ProblemException } from '../../shared/http/problem-details';
import { AuditService } from '../application/audit.service';

interface AccountAuditResponse {
  accountId: string;
  postingCount: number;
  balance: string;
  chainValid: boolean;
  headMatches: boolean;
  reconciled: boolean;
  brokenAtSeq: number | null;
}

interface ConservationResponse {
  conserved: boolean;
  byCurrency: { currency: string; total: string }[];
}

@Controller('audit')
@UseGuards(AccessTokenGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('accounts/:id')
  @RequirePermission('ledger.audit', () => ({ type: 'ledger', id: 'miniledger' }))
  async verifyAccount(@Param('id') id: string): Promise<AccountAuditResponse> {
    const result = await this.audit.verifyAccount(id);
    if (!result.ok) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Account not found',
        status: 404,
        detail: result.error,
      });
    }
    const report = result.value;
    return {
      accountId: report.accountId,
      postingCount: report.postingCount,
      balance: report.balance.toString(),
      chainValid: report.chainValid,
      headMatches: report.headMatches,
      reconciled: report.reconciled,
      brokenAtSeq: report.brokenAtSeq,
    };
  }

  @Get('conservation')
  @RequirePermission('ledger.audit', () => ({ type: 'ledger', id: 'miniledger' }))
  async verifyConservation(): Promise<ConservationResponse> {
    const report = await this.audit.verifyConservation();
    return {
      conserved: report.conserved,
      byCurrency: report.byCurrency.map((entry) => ({
        currency: entry.currency,
        total: entry.total.toString(),
      })),
    };
  }
}
