import BigNumber from 'bignumber.js';
import { GSwapSDKError } from '../classes/gswap_sdk_error.js';
import type { NumericAmount } from '../types/amounts.js';
import { ALL_FEE_TIERS } from '../types/fees.js';
import type { FEE_TIER } from '../types/fees.js';
import { GC_MAX_TICK, GC_MIN_TICK } from './ticks.js';

export function validateNumericAmount(
  amount: NumericAmount,
  parameterName: string,
  allowZero = false,
): void {
  if (typeof amount === 'number') {
    throw new GSwapSDKError(
      `Invalid ${parameterName}: use a decimal string or BigNumber, not a JavaScript number`,
      'VALIDATION_ERROR',
      { type: 'INVALID_NUMERIC_AMOUNT', parameterName, value: amount, reason: 'number_input' },
    );
  }
  const bnAmount = BigNumber(amount);

  if (!bnAmount.isFinite()) {
    throw new GSwapSDKError(
      `Invalid ${parameterName}: must be a finite number`,
      'VALIDATION_ERROR',
      {
        type: 'INVALID_NUMERIC_AMOUNT',
        parameterName,
        value: amount,
        reason: 'not_finite',
      },
    );
  }

  if (!allowZero && bnAmount.isZero()) {
    throw new GSwapSDKError(`Invalid ${parameterName}: must be positive`, 'VALIDATION_ERROR', {
      type: 'INVALID_NUMERIC_AMOUNT',
      parameterName,
      value: amount,
      reason: 'zero_not_allowed',
    });
  }

  if (bnAmount.isNegative()) {
    throw new GSwapSDKError(
      `Invalid ${parameterName}: must be ${allowZero ? 'non-negative' : 'positive'}`,
      'VALIDATION_ERROR',
      {
        type: 'INVALID_NUMERIC_AMOUNT',
        parameterName,
        value: amount,
        reason: 'negative',
      },
    );
  }
}

export function validatePriceValues(
  spotPrice: NumericAmount,
  lowerPrice: NumericAmount,
  upperPrice: NumericAmount,
): void {
  if ([spotPrice, lowerPrice, upperPrice].some((value) => typeof value === 'number')) {
    throw new GSwapSDKError(
      'Invalid price values: use decimal strings or BigNumber values, not JavaScript numbers',
      'VALIDATION_ERROR',
      { type: 'INVALID_NUMERIC_AMOUNT', reason: 'number_input' },
    );
  }
  const bnSpotPrice = BigNumber(spotPrice);
  const bnLowerPrice = BigNumber(lowerPrice);
  let bnUpperPrice = BigNumber(upperPrice);

  bnUpperPrice = bnUpperPrice.isFinite() ? bnUpperPrice : BigNumber(1e18);

  if (
    !bnSpotPrice.isFinite() ||
    !bnLowerPrice.isFinite() ||
    !bnUpperPrice.isFinite() ||
    !bnSpotPrice.isPositive() ||
    !bnLowerPrice.isPositive() ||
    !bnUpperPrice.isPositive()
  ) {
    throw new GSwapSDKError(
      'Invalid price values: all prices must be finite and positive',
      'VALIDATION_ERROR',
      {
        type: 'INVALID_PRICE_VALUES',
        spotPrice,
        lowerPrice,
        upperPrice,
      },
    );
  }

  if (bnLowerPrice.isGreaterThan(bnUpperPrice)) {
    throw new GSwapSDKError(
      'Invalid price range: lower price must be less than or equal to upper price',
      'VALIDATION_ERROR',
      {
        type: 'INVALID_PRICE_RANGE',
        lowerPrice,
        upperPrice,
      },
    );
  }
}

export function validateTokenDecimals(decimals: number, parameterName: string): void {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new GSwapSDKError(
      `Invalid ${parameterName}: must be a non-negative integer`,
      'VALIDATION_ERROR',
      {
        type: 'INVALID_TOKEN_DECIMALS',
        parameterName,
        value: decimals,
      },
    );
  }
}

export function validateTickRange(tickLower: number, tickUpper: number): void {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
    throw new GSwapSDKError('Invalid tick values: ticks must be integers', 'VALIDATION_ERROR', {
      type: 'INVALID_TICK_VALUES',
      tickLower,
      tickUpper,
    });
  }

  if (tickLower >= tickUpper) {
    throw new GSwapSDKError(
      'Invalid tick range: tickLower must be less than tickUpper',
      'VALIDATION_ERROR',
      {
        type: 'INVALID_TICK_RANGE',
        tickLower,
        tickUpper,
      },
    );
  }

  if (tickLower < GC_MIN_TICK || tickUpper > GC_MAX_TICK) {
    throw new GSwapSDKError(
      `Invalid tick range: ticks must be between ${GC_MIN_TICK} and ${GC_MAX_TICK}`,
      'VALIDATION_ERROR',
      {
        type: 'INVALID_TICK_BOUNDS',
        tickLower,
        tickUpper,
        minTick: GC_MIN_TICK,
        maxTick: GC_MAX_TICK,
      },
    );
  }
}

export function validateFee(fee: number): asserts fee is FEE_TIER {
  if (!ALL_FEE_TIERS.some((tier) => Number(tier) === fee)) {
    throw new GSwapSDKError(
      'Invalid fee tier: must be one of 0, 500, 3000, or 10000',
      'VALIDATION_ERROR',
      {
        type: 'INVALID_FEE',
        value: fee,
      },
    );
  }
}

export function validateTickSpacing(tickSpacing: number): void {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new GSwapSDKError(
      'Invalid tick spacing: must be a positive integer',
      'VALIDATION_ERROR',
      {
        type: 'INVALID_TICK_SPACING',
        value: tickSpacing,
      },
    );
  }
}

export function validateWalletAddress(address?: string): asserts address is string {
  if (address === undefined) {
    throw new GSwapSDKError(
      'Invalid wallet address: No wallet address provided',
      'VALIDATION_ERROR',
      {
        type: 'MISSING_WALLET_ADDRESS',
        hint: 'Either provide a wallet address to the function you are calling, or set one when instantiating GSwapSDK',
      },
    );
  }

  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    throw new GSwapSDKError(
      'Invalid wallet address: must be a non-empty string',
      'VALIDATION_ERROR',
      {
        type: 'INVALID_WALLET_ADDRESS',
        value: address,
      },
    );
  }
}
