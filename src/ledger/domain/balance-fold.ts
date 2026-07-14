import { type Posting } from './posting';

export function foldByAccount(postings: readonly Posting[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const posting of postings) {
    const key = posting.accountId.value;
    balances.set(key, (balances.get(key) ?? 0n) + posting.amount.amount);
  }
  return balances;
}

export function totalAmount(postings: readonly Posting[]): bigint {
  return postings.reduce((sum, posting) => sum + posting.amount.amount, 0n);
}
