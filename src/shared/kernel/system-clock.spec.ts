import { CLOCK } from './clock';
import { SystemClock } from './system-clock';

describe('SystemClock', () => {
  it('returns the current time as a Date', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    const after = Date.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it('exposes a DI token', () => {
    expect(typeof CLOCK).toBe('symbol');
  });
});
