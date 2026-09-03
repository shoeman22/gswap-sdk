import BigNumber from 'bignumber.js';
import { FEE_TIER, TICK_SPACING_BY_FEE } from '../types/fees.js';

/** Minimum tick supported by GalaChainDex. */
export const GC_MIN_TICK = -887272;
/** Maximum tick supported by GalaChainDex. */
export const GC_MAX_TICK = 887272;

const DexMath = BigNumber.clone({
  DECIMAL_PLACES: 60,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
});

/** Convert a tick to the corresponding square-root price. */
export function tickToSqrtPrice(tick: number): BigNumber {
  return new DexMath('1.0001').pow(tick / 2);
}

/** Return the greatest tick whose square-root price is no greater than the input. */
export function sqrtPriceToTick(sqrtPrice: BigNumber.Value): number {
  const value = new DexMath(sqrtPrice);
  if (!value.isFinite() || value.isLessThanOrEqualTo(0)) return Number.NaN;

  const approximate = Math.log(value.toNumber() ** 2) / Math.log(1.0001);
  let tick = Math.floor(approximate);
  while (tick < GC_MAX_TICK && tickToSqrtPrice(tick + 1).isLessThanOrEqualTo(value)) tick += 1;
  while (tick > GC_MIN_TICK && tickToSqrtPrice(tick).isGreaterThan(value)) tick -= 1;
  return tick;
}

/** Return the greatest integer tick whose token1/token0 price is no greater than `price`. */
export function tickFromPrice(price: BigNumber.Value): number {
  const value = new DexMath(price);
  if (!value.isFinite() || value.isLessThanOrEqualTo(0)) return Number.NaN;
  const tick = Math.floor(Math.log(value.toNumber()) / Math.log(1.0001));
  return Number.isFinite(tick) ? tick : Number.NaN;
}

/** Align a tick down to the nearest multiple of a positive spacing. */
export function alignTickDown(tick: number, spacing: number): number {
  assertSpacing(spacing);
  return Math.floor(tick / spacing) * spacing;
}

/** Align a tick up to the nearest multiple of a positive spacing. */
export function alignTickUp(tick: number, spacing: number): number {
  assertSpacing(spacing);
  return Math.ceil(tick / spacing) * spacing;
}

/** Validate a position range against the global tick bounds and fee-tier spacing. */
export function assertTickRange(lower: number, upper: number, fee: FEE_TIER): void {
  const spacing = TICK_SPACING_BY_FEE[fee];
  if (spacing === undefined) throw new RangeError(`Unsupported fee tier: ${fee}`);
  if (!Number.isInteger(lower) || !Number.isInteger(upper)) {
    throw new RangeError('Ticks must be integers');
  }
  if (lower < GC_MIN_TICK || upper > GC_MAX_TICK || lower >= upper) {
    throw new RangeError(
      `Tick range must satisfy ${GC_MIN_TICK} <= lower < upper <= ${GC_MAX_TICK}`,
    );
  }
  if (lower % spacing !== 0 || upper % spacing !== 0) {
    throw new RangeError(`Ticks must be aligned to spacing ${spacing}`);
  }
}

function assertSpacing(spacing: number): void {
  if (!Number.isInteger(spacing) || spacing <= 0)
    throw new RangeError('Tick spacing must be positive');
}
