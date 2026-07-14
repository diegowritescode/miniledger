import fc from 'fast-check';
import { Currency } from '../../shared/kernel/currency';
import { Money } from '../../shared/kernel/money';
import { isSufficient } from './overdraft';

const USD = (() => {
  const result = Currency.of('USD');
  if (!result.ok) throw new Error('test setup: USD must be supported');
  return result.value;
})();

describe('isSufficient (properties)', () => {
  it('a floored account never crosses its floor when only sufficient deltas are applied', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000n, max: 1_000n }),
        fc.bigInt({ min: 0n, max: 10_000n }),
        fc.array(fc.bigInt({ min: -1_000n, max: 1_000n }), { maxLength: 50 }),
        (floor, headroom, deltas) => {
          let balance = Money.of(floor + headroom, USD);
          for (const delta of deltas) {
            const move = Money.of(delta, USD);
            if (isSufficient(balance, move, floor)) {
              balance = balance.add(move);
            }
            expect(balance.amount >= floor).toBe(true);
          }
        },
      ),
    );
  });

  it('an exempt account accepts every delta', () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (start, delta) => {
        expect(isSufficient(Money.of(start, USD), Money.of(delta, USD), null)).toBe(true);
      }),
    );
  });
});
