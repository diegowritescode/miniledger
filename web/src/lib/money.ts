export interface CurrencyDef {
  code: string;
  scale: number;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', scale: 2 },
  { code: 'EUR', scale: 2 },
  { code: 'JPY', scale: 0 },
];

export const CURRENCY_CODES = CURRENCIES.map((currency) => currency.code);

function scaleOf(code: string): number {
  return CURRENCIES.find((currency) => currency.code === code)?.scale ?? 2;
}

export function formatMoney(minorUnits: string, currency: string): string {
  const scale = scaleOf(currency);
  const negative = minorUnits.startsWith('-');
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${grouped}${fraction}`;
}
