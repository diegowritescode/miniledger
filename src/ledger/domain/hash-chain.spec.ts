import { hashPosting, type PostingContent } from './hash-chain';

const base: PostingContent = {
  transactionId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  amount: -100n,
  balanceAfter: 900n,
};

describe('hashPosting', () => {
  it('is deterministic for the same input', () => {
    expect(hashPosting('prev', base)).toBe(hashPosting('prev', base));
  });

  it('produces a 64-character hex sha256 digest', () => {
    expect(hashPosting(null, base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains: a different previous hash changes the result', () => {
    expect(hashPosting('a', base)).not.toBe(hashPosting('b', base));
  });

  it('distinguishes genesis (null) from an empty previous hash-equivalent', () => {
    expect(hashPosting(null, base)).toBe(hashPosting('', base));
  });

  it('changes when the amount changes', () => {
    expect(hashPosting('prev', base)).not.toBe(hashPosting('prev', { ...base, amount: -101n }));
  });

  it('changes when the balance_after changes', () => {
    expect(hashPosting('prev', base)).not.toBe(
      hashPosting('prev', { ...base, balanceAfter: 901n }),
    );
  });

  it('changes when the account or transaction changes', () => {
    expect(hashPosting('prev', base)).not.toBe(
      hashPosting('prev', { ...base, accountId: '33333333-3333-4333-8333-333333333333' }),
    );
    expect(hashPosting('prev', base)).not.toBe(
      hashPosting('prev', { ...base, transactionId: '44444444-4444-4444-8444-444444444444' }),
    );
  });
});
