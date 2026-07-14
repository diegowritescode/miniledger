import { AccountId } from './account-id';

describe('AccountId', () => {
  it('generates a UUID value', () => {
    const id = AccountId.generate();

    expect(id.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates distinct values', () => {
    expect(AccountId.generate().equals(AccountId.generate())).toBe(false);
  });

  it('round-trips through a string', () => {
    const original = AccountId.generate();
    const restored = AccountId.fromString(original.value);

    expect(restored.value).toBe(original.value);
    expect(restored.equals(original)).toBe(true);
  });

  it('compares by value', () => {
    const value = AccountId.generate().value;

    expect(AccountId.fromString(value).equals(AccountId.fromString(value))).toBe(true);
    expect(AccountId.fromString(value).equals(AccountId.generate())).toBe(false);
  });
});
