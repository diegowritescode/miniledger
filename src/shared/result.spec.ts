import { err, ok } from './result';

describe('Result', () => {
  it('ok wraps a success value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err wraps a failure value', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });
});
