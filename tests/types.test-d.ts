import type {
  AddLiquidityDTO,
  CreatePoolDTO,
  RemoveLiquidityDTO,
  TradeDTO,
} from '../src/types/v2_dtos.js';
import type { SwapAmount } from '../src/classes/swaps.js';

const base = { token0: 'GALA', token1: 'GUSDC', fee: 3000, uniqueKey: 'u' } as const;

const validTrade: TradeDTO = { ...base, sell0Qty: '1' };
const validAdd: AddLiquidityDTO = {
  ...base,
  tickLower: -60,
  tickUpper: 60,
  depositQuantityToken0: '1',
};
const validRemove: RemoveLiquidityDTO = { ...base, tickLower: -60, tickUpper: 60 };
const validPool: CreatePoolDTO = {
  token0Key: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
  token1Key: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
  token0Symbol: 'GALA',
  token1Symbol: 'GUSDC',
  fee: 3000,
  uniqueKey: 'u',
  startingPrice: '1',
};
const validSwap: SwapAmount = { exactIn: '1' };
void validTrade;
void validAdd;
void validRemove;
void validPool;
void validSwap;

// @ts-expect-error Trade must contain exactly one trade-side quantity.
const invalidTrade: TradeDTO = { ...base, sell0Qty: '1', buy1Qty: '1' };
// @ts-expect-error AddLiquidity must contain exactly one deposit quantity.
const invalidAdd: AddLiquidityDTO = {
  ...base,
  tickLower: -60,
  tickUpper: 60,
  depositQuantityToken0: '1',
  depositQuantityToken1: '1',
};
// @ts-expect-error RemoveLiquidity permits at most one withdrawal quantity.
const invalidRemove: RemoveLiquidityDTO = {
  ...base,
  tickLower: -60,
  tickUpper: 60,
  withdrawalQuantityToken0: '1',
  withdrawalQuantityToken1: '1',
};
// @ts-expect-error CreatePool must contain exactly one starting-price representation.
const invalidPool: CreatePoolDTO = { ...validPool, startingSqrtPrice: '1' };
// @ts-expect-error SwapAmount must contain exactly one direction.
const invalidSwap: SwapAmount = { exactIn: '1', exactOut: '1' };
void invalidTrade;
void invalidAdd;
void invalidRemove;
void invalidPool;
void invalidSwap;
