import type BigNumber from 'bignumber.js';
import type { Brand } from './branding.js';

export type NumericAmount = string | number | BigNumber;

export type SqrtPrice = Brand<BigNumber, 'SqrtPrice'>;
export type SqrtPriceIn = Brand<NumericAmount, 'SqrtPriceIn'> | SqrtPrice;

export type Price = Brand<BigNumber, 'Price'>;
export type PriceIn = Brand<NumericAmount, 'PriceIn'> | Price;
