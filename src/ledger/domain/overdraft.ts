import { type Money } from '../../shared/kernel/money';

export function isSufficient(currentBalance: Money, delta: Money, floor: bigint | null): boolean {
  if (floor === null) return true;
  return currentBalance.add(delta).amount >= floor;
}
