import { TransactionId } from './transaction-id';

describe('TransactionId', () => {
  it('generates distinct ids', () => {
    expect(TransactionId.generate().value).not.toBe(TransactionId.generate().value);
  });

  it('round-trips through a string', () => {
    const id = TransactionId.generate();
    expect(TransactionId.fromString(id.value).equals(id)).toBe(true);
  });

  it('is not equal to a different id', () => {
    expect(TransactionId.fromString('a').equals(TransactionId.fromString('b'))).toBe(false);
  });
});
