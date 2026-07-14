import { createHash } from 'node:crypto';

export interface PostingContent {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: bigint;
  readonly balanceAfter: bigint;
}

export function hashPosting(prevHash: string | null, content: PostingContent): string {
  const canonical = [
    prevHash ?? '',
    content.transactionId,
    content.accountId,
    content.amount.toString(),
    content.balanceAfter.toString(),
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
