import { err, ok, type Result } from '../result';

export type CurrencyError = 'unknown_currency';

interface CurrencyDefinition {
  readonly code: string;
  readonly minorUnitScale: number;
}

const SUPPORTED: Readonly<Record<string, CurrencyDefinition>> = {
  USD: { code: 'USD', minorUnitScale: 2 },
  EUR: { code: 'EUR', minorUnitScale: 2 },
  JPY: { code: 'JPY', minorUnitScale: 0 },
};

export class Currency {
  private constructor(
    readonly code: string,
    readonly minorUnitScale: number,
  ) {}

  static of(code: string): Result<Currency, CurrencyError> {
    const definition = SUPPORTED[code];
    if (!definition) return err('unknown_currency');
    return ok(new Currency(definition.code, definition.minorUnitScale));
  }

  static codes(): readonly string[] {
    return Object.keys(SUPPORTED);
  }

  equals(other: Currency): boolean {
    return this.code === other.code;
  }
}
