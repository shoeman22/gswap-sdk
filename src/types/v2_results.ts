import type BigNumber from 'bignumber.js';

/** Pool metadata returned by GalaChainDex. */
export interface PoolInfo {
  token0: string;
  token1: string;
  fee: number;
  name?: string;
  token0Key: string;
  token1Key: string;
  tickSpacing: number;
  protocolFees: number;
  tradingFees: number;
  creator?: string;
  isPrivate?: boolean;
}

/** Current pool price state. */
export interface Slot0 {
  token0: string;
  token1: string;
  fee: number;
  price: string;
  sqrtPrice: string;
  tick: number;
  flippedFromRequest?: boolean;
}

/** Full raw composite pool snapshot returned by the contract. */
export interface CompositePool {
  pool: PoolInfo;
  currentTradingPrice: Slot0;
  initializedTicks?: Array<{ pool: string; lexigraphicTickIndex: string }>;
  reverseInitializedTicks?: Array<{ pool: string; lexigraphicTickIndex: string }>;
  positionBoundaries?: unknown[];
  positions?: Array<{
    pool: string;
    lexigraphicTickIndexLow: string;
    lexigraphicTickIndexHigh: string;
    owner: string;
    liquidity: string;
  }>;
  token0TradingSymbol?: { symbol: string; decimals: number };
  token1TradingSymbol?: { symbol: string; decimals: number };
  token0LiquidityBalance?: TokenBalance;
  token1LiquidityBalance?: TokenBalance;
  token0ProtocolFeesBalance?: TokenBalance;
  token1ProtocolFeesBalance?: TokenBalance;
}

/** A token balance embedded in a composite pool result. */
export interface TokenBalance {
  collection?: string;
  category?: string;
  type?: string;
  additionalKey?: string;
  quantity?: string;
  owner?: string;
}

/** A normalized current-contract liquidity position. */
export interface Position {
  pool: string;
  token0Symbol: string;
  token1Symbol: string;
  token0CompositeKey?: string;
  token1CompositeKey?: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  owner: string;
  liquidity: string;
  amount0: string;
  amount1: string;
  inRange: boolean;
  currentTick?: number;
  sqrtPrice?: string;
  fees0?: string;
  fees1?: string;
}

/** Quote response returned by `/v2/trade/quote`. */
export interface QuoteResult {
  contractVersion: 'v2';
  fee: number;
  amountIn: string;
  amountOut: string;
  currentSqrtPrice: string;
  newSqrtPrice: string;
  newTick: number;
  tradingFees: string;
  protocolFees: string;
  totalFees: string;
  feeTokenSymbol: string;
  token0Symbol: string;
  token1Symbol: string;
  tokenInIsToken0: boolean;
  feeTier: number;
  currentPrice: BigNumber;
  newPrice: BigNumber;
  priceImpact: BigNumber;
}

/** Indexed trade data returned by explore confirmation. */
export interface IndexedTransaction {
  uniqueKey: string;
  transactionId: string;
  blockNumber: number;
  poolHash: string | null;
  userAddress: string | null;
  token0: string | null;
  token1: string | null;
  amount0: number;
  amount1: number;
  volume: number;
  transactionTime: string | null;
}

/** Backend add-liquidity estimate. */
export interface AddLiquidityEstimate {
  amount0: string;
  amount1: string;
  liquidity: string;
  token0Symbol: string;
  token1Symbol: string;
  tickLower: number;
  tickUpper: number;
  amountIsCanonicalToken0: boolean;
}

/** Backend remove-liquidity estimate. */
export interface RemoveLiquidityEstimate {
  amount0: string;
  amount1: string;
}

/** A symbol registry entry returned by FetchTokenTradingSymbols. */
export interface TradingSymbol {
  symbol: string;
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
  decimals: number;
}

/** Result envelope returned by the chain gateway for a submitted write. */
export interface ChainSubmissionResult {
  transactionId?: string;
  mode: 'sync';
  result: unknown;
}
