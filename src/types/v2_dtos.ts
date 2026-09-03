import type { FEE_TIER } from './fees.js';
import type { GalaChainTokenClassKey } from './token.js';

/** Common identity fields for v2 pool writes. */
export interface V2PoolWriteBase {
  token0: string;
  token1: string;
  fee: FEE_TIER;
  uniqueKey: string;
}

/** A v2 trade with exactly one selected trade-side quantity. */
export type TradeDTO = V2PoolWriteBase &
  ({ sell0Qty: string } | { sell1Qty: string } | { buy0Qty: string } | { buy1Qty: string }) & {
    amountOutMinimum?: string;
    amountInMaximum?: string;
  };

/** A v2 liquidity deposit with exactly one selected deposit quantity. */
export type AddLiquidityDTO = V2PoolWriteBase & {
  tickLower: number;
  tickUpper: number;
} & ({ depositQuantityToken0: string } | { depositQuantityToken1: string });

/** A v2 liquidity withdrawal; omitting both quantities closes the position. */
export interface RemoveLiquidityDTO extends V2PoolWriteBase {
  tickLower: number;
  tickUpper: number;
  withdrawalQuantityToken0?: string;
  withdrawalQuantityToken1?: string;
}

/** A v2 request to sweep all fees from one position. */
export interface CollectPositionFeesDTO extends V2PoolWriteBase {
  tickLower: number;
  tickUpper: number;
}

/** A v2 pool creation request with exactly one initial-price representation. */
export type CreatePoolDTO = {
  token0Key: GalaChainTokenClassKey;
  token1Key: GalaChainTokenClassKey;
  token0Symbol: string;
  token1Symbol: string;
  fee: FEE_TIER;
  isPrivate?: boolean;
  privateAccess?: string[];
  uniqueKey: string;
} & ({ startingPrice: string } | { startingSqrtPrice: string });

/** Optional page cursor accepted by chain read methods. */
export interface PageDTO {
  limit?: number;
  bookmark?: string;
}

/** Fetch all registered trading symbols. */
export type FetchTokenTradingSymbolsDTO = PageDTO;

/** Fetch a composite pool snapshot. */
export interface FetchCompositePoolDataDTO {
  token0: string;
  token1: string;
  fee: FEE_TIER;
}

/** Fetch one current trading price, or all prices when no pair is supplied. */
export type FetchCurrentTradingPricesDTO = Partial<FetchCompositePoolDataDTO> & PageDTO;

/** Fetch pools, optionally narrowed to one pair and paged. */
export type FetchPoolsDTO = Partial<FetchCompositePoolDataDTO> & PageDTO;

/** Fetch all liquidity positions, optionally narrowed to a pool reference. */
export interface FetchLiquidityPositionsDTO extends PageDTO {
  pool?: string;
}
