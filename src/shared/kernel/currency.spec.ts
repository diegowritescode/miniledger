import { Currency } from './currency';

describe('Currency', () => {
  it('resolves a supported code with its minor-unit scale', () => {
    const usd = Currency.of('USD');
    expect(usd.ok).toBe(true);
    if (!usd.ok) return;
    expect(usd.value.code).toBe('USD');
    expect(usd.value.minorUnitScale).toBe(2);
  });

  it('knows currencies with a zero minor-unit scale', () => {
    const jpy = Currency.of('JPY');
    expect(jpy.ok).toBe(true);
    if (!jpy.ok) return;
    expect(jpy.value.minorUnitScale).toBe(0);
  });

  it('rejects an unknown code', () => {
    const result = Currency.of('ZZZ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown_currency');
  });

  it('exposes the supported codes', () => {
    expect(Currency.codes()).toEqual(expect.arrayContaining(['USD', 'EUR', 'JPY']));
  });

  it('compares by code', () => {
    const a = Currency.of('USD');
    const b = Currency.of('USD');
    const c = Currency.of('EUR');
    if (!a.ok || !b.ok || !c.ok) throw new Error('unreachable');
    expect(a.value.equals(b.value)).toBe(true);
    expect(a.value.equals(c.value)).toBe(false);
  });
});
