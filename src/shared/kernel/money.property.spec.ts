import fc from 'fast-check';
import { Currency } from './currency';
import { Money } from './money';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('test setup: USD must be supported');
  return result.value;
})();

const money = (): fc.Arbitrary<Money> => fc.bigInt().map((amount) => Money.of(amount, USD));

describe('Money (properties)', () => {
  it('double negation is the identity', () => {
    fc.assert(
      fc.property(money(), (m) => {
        expect(m.negate().negate().equals(m)).toBe(true);
      }),
    );
  });

  it('an amount plus its negation is zero', () => {
    fc.assert(
      fc.property(money(), (m) => {
        expect(m.add(m.negate()).isZero()).toBe(true);
      }),
    );
  });

  it('zero is the additive identity', () => {
    fc.assert(
      fc.property(money(), (m) => {
        expect(m.add(Money.zero(USD)).equals(m)).toBe(true);
      }),
    );
  });

  it('addition is commutative within a currency', () => {
    fc.assert(
      fc.property(money(), money(), (a, b) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
      }),
    );
  });

  it('addition is associative within a currency', () => {
    fc.assert(
      fc.property(money(), money(), money(), (a, b, c) => {
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true);
      }),
    );
  });

  it('sum equals the left fold of add', () => {
    fc.assert(
      fc.property(fc.array(money()), (monies) => {
        const summed = Money.sum(monies, USD);
        const folded = monies.reduce((total, m) => total.add(m), Money.zero(USD));
        expect(summed.equals(folded)).toBe(true);
      }),
    );
  });

  it('is exact for arbitrarily large amounts (no precision loss)', () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (a, b) => {
        expect(Money.of(a, USD).add(Money.of(b, USD)).amount).toBe(a + b);
      }),
    );
  });
});
