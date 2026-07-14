import fc from 'fast-check';
import { type ChainEntry, hashPosting, type PostingContent, verifyChain } from './hash-chain';

const content = (): fc.Arbitrary<PostingContent> =>
  fc.record({
    transactionId: fc.uuid(),
    accountId: fc.uuid(),
    amount: fc.bigInt(),
    balanceAfter: fc.bigInt(),
  });

const contents = (): fc.Arbitrary<PostingContent[]> =>
  fc.array(content(), { minLength: 1, maxLength: 8 });

const buildChain = (values: PostingContent[]): ChainEntry[] => {
  let prev: string | null = null;
  const entries: ChainEntry[] = [];
  for (const value of values) {
    const hash = hashPosting(prev, value);
    entries.push({ prevHash: prev, hash, content: value });
    prev = hash;
  }
  return entries;
};

describe('verifyChain (properties)', () => {
  it('verifies any untampered chain', () => {
    fc.assert(
      fc.property(contents(), (values) => {
        expect(verifyChain(buildChain(values))).toEqual({ valid: true, brokenAtIndex: null });
      }),
    );
  });

  it('breaks at the index of a mutated amount', () => {
    fc.assert(
      fc.property(contents(), fc.nat(), fc.bigInt(), (values, rawIndex, other) => {
        const index = rawIndex % values.length;
        fc.pre(values[index]!.amount !== other);
        const tampered = buildChain(values).map((entry, i) =>
          i === index ? { ...entry, content: { ...entry.content, amount: other } } : entry,
        );
        expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: index });
      }),
    );
  });

  it('breaks at the index of a mutated balanceAfter', () => {
    fc.assert(
      fc.property(contents(), fc.nat(), fc.bigInt(), (values, rawIndex, other) => {
        const index = rawIndex % values.length;
        fc.pre(values[index]!.balanceAfter !== other);
        const tampered = buildChain(values).map((entry, i) =>
          i === index ? { ...entry, content: { ...entry.content, balanceAfter: other } } : entry,
        );
        expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: index });
      }),
    );
  });

  it('breaks at the index of a mutated stored hash', () => {
    fc.assert(
      fc.property(contents(), fc.nat(), fc.string(), (values, rawIndex, other) => {
        const index = rawIndex % values.length;
        const chain = buildChain(values);
        fc.pre(chain[index]!.hash !== other);
        const tampered = chain.map((entry, i) => (i === index ? { ...entry, hash: other } : entry));
        expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: index });
      }),
    );
  });

  it('breaks at the index of a mutated prevHash link', () => {
    fc.assert(
      fc.property(contents(), fc.nat(), fc.string(), (values, rawIndex, other) => {
        const index = rawIndex % values.length;
        const chain = buildChain(values);
        fc.pre(chain[index]!.prevHash !== other);
        const tampered = chain.map((entry, i) =>
          i === index ? { ...entry, prevHash: other } : entry,
        );
        expect(verifyChain(tampered)).toEqual({ valid: false, brokenAtIndex: index });
      }),
    );
  });
});
