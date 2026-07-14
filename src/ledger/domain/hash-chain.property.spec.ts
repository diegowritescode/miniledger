import fc from 'fast-check';
import { hashPosting, type PostingContent } from './hash-chain';

const uuid = (): fc.Arbitrary<string> => fc.uuid();

const content = (): fc.Arbitrary<PostingContent> =>
  fc.record({
    transactionId: uuid(),
    accountId: uuid(),
    amount: fc.bigInt(),
    balanceAfter: fc.bigInt(),
  });

describe('hashPosting (properties)', () => {
  it('is deterministic', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), content(), (prev, value) => {
        expect(hashPosting(prev, value)).toBe(hashPosting(prev, value));
      }),
    );
  });

  it('is sensitive to the amount', () => {
    fc.assert(
      fc.property(content(), fc.bigInt(), (value, other) => {
        fc.pre(value.amount !== other);
        expect(hashPosting('prev', value)).not.toBe(
          hashPosting('prev', { ...value, amount: other }),
        );
      }),
    );
  });

  it('is sensitive to the balance_after', () => {
    fc.assert(
      fc.property(content(), fc.bigInt(), (value, other) => {
        fc.pre(value.balanceAfter !== other);
        expect(hashPosting('prev', value)).not.toBe(
          hashPosting('prev', { ...value, balanceAfter: other }),
        );
      }),
    );
  });

  it('is sensitive to the previous hash', () => {
    fc.assert(
      fc.property(content(), fc.string(), fc.string(), (value, a, b) => {
        fc.pre(a !== b);
        expect(hashPosting(a, value)).not.toBe(hashPosting(b, value));
      }),
    );
  });
});
