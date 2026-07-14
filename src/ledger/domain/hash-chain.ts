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

export interface ChainEntry {
  readonly prevHash: string | null;
  readonly hash: string;
  readonly content: PostingContent;
}

export interface ChainVerification {
  readonly valid: boolean;
  readonly brokenAtIndex: number | null;
}

export function verifyChain(entries: readonly ChainEntry[]): ChainVerification {
  let prev: string | null = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.prevHash !== prev || entry.hash !== hashPosting(prev, entry.content)) {
      return { valid: false, brokenAtIndex: index };
    }
    prev = entry.hash;
  }
  return { valid: true, brokenAtIndex: null };
}
