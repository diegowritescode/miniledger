import { type ChainEntry, hashPosting, type PostingContent, verifyChain } from './hash-chain';

const content = (amount: bigint, balanceAfter: bigint): PostingContent => ({
  transactionId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  amount,
  balanceAfter,
});

const buildChain = (contents: PostingContent[]): ChainEntry[] => {
  let prev: string | null = null;
  const entries: ChainEntry[] = [];
  for (const value of contents) {
    const hash = hashPosting(prev, value);
    entries.push({ prevHash: prev, hash, content: value });
    prev = hash;
  }
  return entries;
};

describe('verifyChain', () => {
  it('reports an empty chain as valid', () => {
    expect(verifyChain([])).toEqual({ valid: true, brokenAtIndex: null });
  });

  it('verifies a single untampered entry', () => {
    const chain = buildChain([content(1000n, 1000n)]);
    expect(verifyChain(chain)).toEqual({ valid: true, brokenAtIndex: null });
  });

  it('verifies a multi-entry untampered chain', () => {
    const chain = buildChain([content(1000n, 1000n), content(-300n, 700n), content(-200n, 500n)]);
    expect(verifyChain(chain)).toEqual({ valid: true, brokenAtIndex: null });
  });

  it('rejects a first entry whose prevHash is not null', () => {
    const chain = buildChain([content(1000n, 1000n)]);
    const tampered = [{ ...chain[0]!, prevHash: 'not-null' }];
    expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: 0 });
  });

  it('breaks at the index whose amount was mutated', () => {
    const chain = buildChain([content(1000n, 1000n), content(-300n, 700n), content(-200n, 500n)]);
    const tampered = chain.map((entry, index) =>
      index === 1 ? { ...entry, content: { ...entry.content, amount: -301n } } : entry,
    );
    expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: 1 });
  });

  it('breaks at the index whose balanceAfter was mutated', () => {
    const chain = buildChain([content(1000n, 1000n), content(-300n, 700n), content(-200n, 500n)]);
    const tampered = chain.map((entry, index) =>
      index === 2 ? { ...entry, content: { ...entry.content, balanceAfter: 501n } } : entry,
    );
    expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: 2 });
  });

  it('breaks at the index whose stored hash was mutated', () => {
    const chain = buildChain([content(1000n, 1000n), content(-300n, 700n)]);
    const tampered = chain.map((entry, index) =>
      index === 0 ? { ...entry, hash: 'f'.repeat(64) } : entry,
    );
    expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: 0 });
  });

  it('breaks at the index whose prevHash link was mutated', () => {
    const chain = buildChain([content(1000n, 1000n), content(-300n, 700n)]);
    const tampered = chain.map((entry, index) =>
      index === 1 ? { ...entry, prevHash: 'a'.repeat(64) } : entry,
    );
    expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: 1 });
  });
});
