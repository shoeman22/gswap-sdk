import BigNumber from 'bignumber.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import type { ChainGateway, ChainSubmitOptions } from './gateway.js';
import { HttpClient } from './http_client.js';
import type { GalaChainSigner } from './signers.js';
import type { Symbols } from './symbols.js';
import type { NumericAmount, PriceIn } from '../types/amounts.js';
import type { FEE_TIER } from '../types/fees.js';
import type {
  AddLiquidityDTO,
  CollectPositionFeesDTO,
  CreatePoolDTO,
  RemoveLiquidityDTO,
} from '../types/v2_dtos.js';
import type {
  AddLiquidityEstimate,
  Position,
  RemoveLiquidityEstimate,
} from '../types/v2_results.js';
import { type TokenRef, compositeKeyOf, parseTokenClassKey } from '../utils/ordering.js';
import { validateFee, validateNumericAmount } from '../utils/validation.js';
import { alignTickDown, alignTickUp, assertTickRange, tickFromPrice } from '../utils/ticks.js';

type PositionGateway = Pick<ChainGateway, 'submit' | 'httpRequestor' | 'dexBackendBaseUrl'> & {
  requestTimeoutMs?: number | undefined;
};
type PositionSymbols = Pick<Symbols, 'resolve' | 'orderPair'> & { invalidate?: () => void };

interface BackendEnvelope<TData> {
  data: TData;
}

interface PositionWire {
  token0CompositeKey?: string;
  token1CompositeKey?: string;
  token0Symbol: string;
  token1Symbol: string;
  fee: FEE_TIER;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  inRange: boolean;
  owner: string;
  currentTick?: number;
  sqrtPrice?: string;
  pool?: string;
  poolRef?: string;
  fees0?: string;
  fees1?: string;
}

interface AddLiquidityEstimateWire {
  amount0: string;
  amount1: string;
  liquidity: string;
  token0Symbol: string;
  token1Symbol: string;
  tickLower: number;
  tickUpper: number;
  amountIsCanonicalToken0: boolean;
}

interface RemoveLiquidityEstimateWire {
  amount0: string;
  amount1: string;
}

interface ResolvedCreateToken {
  symbol: string;
  classKey: ReturnType<typeof parseTokenClassKey>;
}

/**
 * Manages current-contract concentrated-liquidity positions.
 *
 * @example
 * ```typescript
 * const positions = gSwap.positions;
 * const mine = await positions.getUserPositions('client|012345678901234567890123');
 * console.log(mine.length);
 * ```
 */
export class Positions {
  constructor(
    private readonly gateway: PositionGateway,
    private readonly symbols: PositionSymbols,
    private readonly signer?: GalaChainSigner,
    private readonly walletAddress?: string,
  ) {
    this.http = new HttpClient(gateway.httpRequestor, gateway.requestTimeoutMs ?? 30_000);
  }

  private readonly http: HttpClient;

  /**
   * Gets all current-contract positions owned by an address.
   *
   * @param owner - GalaChain owner identity.
   * @returns Enriched positions from the v2 trade backend.
   * @example
   * ```typescript
   * const positions = await gSwap.positions.getUserPositions('client|012345678901234567890123');
   * ```
   */
  async getUserPositions(owner: string): Promise<Position[]> {
    const response = await this.get<PositionWire[]>('/positions', { user: owner });
    return response.data.map((position) => this.mapPosition(position));
  }

  /**
   * Gets one position, normalizing a caller-supplied reversed pair to canonical symbol order.
   * Reversed pairs also invert the price axis, so `[lower, upper]` becomes `[-upper, -lower]`.
   *
   * @param args - Pair, owner, fee, and position tick range.
   * @returns The position, or `null` when the backend returns 404.
   * @example
   * ```typescript
   * const position = await gSwap.positions.getPosition({
   *   token0: 'GALA', token1: 'GUSDC', owner: 'client|012345678901234567890123',
   *   fee: 3000, tickLower: -19200, tickUpper: 12000,
   * });
   * ```
   */
  async getPosition(
    args: {
      token0: TokenRef;
      token1: TokenRef;
      fee: FEE_TIER;
      owner: string;
      tickLower: number;
      tickUpper: number;
    },
    signal?: AbortSignal,
  ): Promise<Position | null> {
    const pair = await this.symbols.orderPair(args.token0, args.token1);
    const ticks = this.canonicalTicks(args.tickLower, args.tickUpper, pair.flipped);
    const response = await this.getNullable<PositionWire>(
      '/position',
      {
        token0: pair.token0.symbol,
        token1: pair.token1.symbol,
        fee: `${args.fee}`,
        owner: args.owner,
        tickLower: `${ticks.tickLower}`,
        tickUpper: `${ticks.tickUpper}`,
      },
      signal,
    );
    return response === null ? null : this.mapPosition(response.data);
  }

  /**
   * Estimates the other token amount and resulting liquidity for a deposit.
   *
   * @param args - Pair, tick range, deposit amount, and the amount's caller-side token index.
   * @returns Backend liquidity estimate.
   * @example
   * ```typescript
   * const estimate = await gSwap.positions.estimateAddLiquidity({
   *   token0: 'GALA', token1: 'GUSDC', fee: 3000,
   *   tickLower: -19200, tickUpper: 12000, amount: '100', amountIsToken0: true,
   * });
   * ```
   */
  async estimateAddLiquidity(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    tickLower: number;
    tickUpper: number;
    amount: NumericAmount;
    amountIsToken0: boolean;
  }): Promise<AddLiquidityEstimate> {
    validateNumericAmount(args.amount, 'amount');
    const response = await this.get<AddLiquidityEstimateWire>('/add-liq-estimate', {
      token0: this.requestToken(args.token0),
      token1: this.requestToken(args.token1),
      fee: `${args.fee}`,
      tickLower: `${args.tickLower}`,
      tickUpper: `${args.tickUpper}`,
      amount: new BigNumber(args.amount).toFixed(),
      amountIsToken0: String(args.amountIsToken0),
    });
    return response.data;
  }

  /**
   * Estimates token amounts released by burning liquidity.
   *
   * @param args - Pair, tick range, fee tier, and liquidity quantity.
   * @returns Estimated token0 and token1 quantities.
   * @example
   * ```typescript
   * const estimate = await gSwap.positions.estimateRemoveLiquidity({
   *   token0: 'GALA', token1: 'GUSDC', fee: 3000,
   *   tickLower: -19200, tickUpper: 12000, liquidity: '1000',
   * });
   * ```
   */
  async estimateRemoveLiquidity(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    tickLower: number;
    tickUpper: number;
    liquidity: NumericAmount;
  }): Promise<RemoveLiquidityEstimate> {
    validateNumericAmount(args.liquidity, 'liquidity');
    const response = await this.get<RemoveLiquidityEstimateWire>('/remove-liq-estimate', {
      token0: this.requestToken(args.token0),
      token1: this.requestToken(args.token1),
      fee: `${args.fee}`,
      tickLower: `${args.tickLower}`,
      tickUpper: `${args.tickUpper}`,
      liquidity: new BigNumber(args.liquidity).toFixed(),
    });
    return response.data;
  }

  /**
   * Adds liquidity using an explicit tick range. Exactly one canonical deposit field is emitted.
   *
   * @param args - Pair, fee, range, deposit amount, and caller-side token index.
   * @returns The synchronously submitted transaction.
   * @example
   * ```typescript
   * const tx = await gSwap.positions.addLiquidityByTicks({
   *   token0: 'GALA', token1: 'GUSDC', fee: 3000,
   *   tickLower: -19200, tickUpper: 12000, amount: '100', amountIsToken0: true,
   * });
   * await tx.confirm();
   * ```
   */
  async addLiquidityByTicks(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    tickLower: number;
    tickUpper: number;
    amount: NumericAmount;
    amountIsToken0: boolean;
  }) {
    validateFee(args.fee);
    const pair = await this.symbols.orderPair(args.token0, args.token1);
    const ticks = this.canonicalTicks(args.tickLower, args.tickUpper, pair.flipped);
    assertTickRange(ticks.tickLower, ticks.tickUpper, args.fee);
    validateNumericAmount(args.amount, 'amount');
    const amount = new BigNumber(args.amount).toFixed();
    const dto: AddLiquidityDTO = {
      token0: pair.token0.symbol,
      token1: pair.token1.symbol,
      fee: args.fee,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
      uniqueKey: this.uniqueKey(),
      ...(pair.flipped !== args.amountIsToken0
        ? { depositQuantityToken0: amount }
        : { depositQuantityToken1: amount }),
    };
    return this.submit('AddLiquidity', dto as unknown as Record<string, unknown>, {
      token0: pair.token0.symbol,
      token1: pair.token1.symbol,
      fee: args.fee,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
    });
  }

  /**
   * Adds liquidity from prices, flooring the lower tick and ceiling the upper tick to fee spacing.
   * The resulting range is therefore no narrower than the requested price interval.
   *
   * @param args - Pair, fee, price range, deposit amount, and caller-side token index.
   * @returns The synchronously submitted transaction.
   * @example
   * ```typescript
   * const tx = await gSwap.positions.addLiquidityByPrice({
   *   token0: 'GALA', token1: 'GUSDC', fee: 3000,
   *   minPrice: '0.14', maxPrice: '0.16', amount: '100', amountIsToken0: true,
   * });
   * ```
   */
  async addLiquidityByPrice(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    minPrice: PriceIn;
    maxPrice: PriceIn;
    amount: NumericAmount;
    amountIsToken0: boolean;
  }) {
    validateFee(args.fee);
    this.rejectNumber(args.minPrice, 'minPrice');
    this.rejectNumber(args.maxPrice, 'maxPrice');
    const minPrice = new BigNumber(args.minPrice);
    const maxPrice = new BigNumber(args.maxPrice);
    if (
      !minPrice.isFinite() ||
      !maxPrice.isFinite() ||
      minPrice.isLessThanOrEqualTo(0) ||
      maxPrice.isLessThanOrEqualTo(0)
    ) {
      throw new GSwapSDKError('Price bounds must be finite and positive.', 'VALIDATION_ERROR');
    }
    if (minPrice.isGreaterThan(maxPrice)) {
      throw new GSwapSDKError(
        'minPrice must be less than or equal to maxPrice.',
        'VALIDATION_ERROR',
      );
    }
    const spacing = this.tickSpacing(args.fee);
    const tickLower = alignTickDown(tickFromPrice(minPrice), spacing);
    const tickUpper = alignTickUp(tickFromPrice(maxPrice), spacing);
    return this.addLiquidityByTicks({
      token0: args.token0,
      token1: args.token1,
      fee: args.fee,
      tickLower,
      tickUpper,
      amount: args.amount,
      amountIsToken0: args.amountIsToken0,
    });
  }

  /**
   * Removes liquidity by withdrawing at most one canonical token quantity.
   * Omitting both amounts closes the position and sweeps all accrued fees.
   *
   * @param args - Pair, fee, range, and optional caller-side withdrawal amount.
   * @returns The synchronously submitted transaction.
   * @example
   * ```typescript
   * const tx = await gSwap.positions.removeLiquidity({
   *   token0: 'GALA', token1: 'GUSDC', fee: 3000,
   *   tickLower: -19200, tickUpper: 12000,
   * });
   * ```
   */
  async removeLiquidity(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    tickLower: number;
    tickUpper: number;
    amount0?: NumericAmount | undefined;
    amount1?: NumericAmount | undefined;
  }) {
    validateFee(args.fee);
    const pair = await this.symbols.orderPair(args.token0, args.token1);
    const ticks = this.canonicalTicks(args.tickLower, args.tickUpper, pair.flipped);
    assertTickRange(ticks.tickLower, ticks.tickUpper, args.fee);
    if (args.amount0 !== undefined && args.amount1 !== undefined) {
      throw new GSwapSDKError('Provide at most one of amount0 or amount1.', 'VALIDATION_ERROR');
    }
    if (args.amount0 !== undefined) validateNumericAmount(args.amount0, 'amount0');
    if (args.amount1 !== undefined) validateNumericAmount(args.amount1, 'amount1');
    const withdrawal =
      args.amount0 !== undefined
        ? pair.flipped
          ? { withdrawalQuantityToken1: new BigNumber(args.amount0).toFixed() }
          : { withdrawalQuantityToken0: new BigNumber(args.amount0).toFixed() }
        : args.amount1 !== undefined
          ? pair.flipped
            ? { withdrawalQuantityToken0: new BigNumber(args.amount1).toFixed() }
            : { withdrawalQuantityToken1: new BigNumber(args.amount1).toFixed() }
          : {};
    const dto: RemoveLiquidityDTO = {
      token0: pair.token0.symbol,
      token1: pair.token1.symbol,
      fee: args.fee,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
      uniqueKey: this.uniqueKey(),
      ...withdrawal,
    };
    return this.submit('RemoveLiquidity', dto as unknown as Record<string, unknown>, {
      token0: pair.token0.symbol,
      token1: pair.token1.symbol,
      fee: args.fee,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
    });
  }

  /**
   * Collects all accrued fees for a position; the contract does not support partial collection.
   *
   * @param args - Pair, fee, and tick range identifying the position.
   * @returns The synchronously submitted transaction.
   * @example
   * ```typescript
   * const tx = await gSwap.positions.collectPositionFees({
   *   token0: 'GALA', token1: 'GUSDC', fee: 3000,
   *   tickLower: -19200, tickUpper: 12000,
   * });
   * ```
   */
  async collectPositionFees(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    tickLower: number;
    tickUpper: number;
  }) {
    validateFee(args.fee);
    const pair = await this.symbols.orderPair(args.token0, args.token1);
    const ticks = this.canonicalTicks(args.tickLower, args.tickUpper, pair.flipped);
    assertTickRange(ticks.tickLower, ticks.tickUpper, args.fee);
    const dto: CollectPositionFeesDTO = {
      token0: pair.token0.symbol,
      token1: pair.token1.symbol,
      fee: args.fee,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
      uniqueKey: this.uniqueKey(),
    };
    return this.submit('CollectPositionFees', dto as unknown as Record<string, unknown>, {
      token0: pair.token0.symbol,
      token1: pair.token1.symbol,
      fee: args.fee,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
    });
  }

  /**
   * Creates a pool, resolving registered trading symbols and falling back to class collections.
   * Reversed symbol order inverts the supplied starting price or square-root price.
   *
   * @param args - Token class keys or references, fee, exactly one starting price field, and privacy options.
   * @returns The synchronously submitted transaction.
   * @example
   * ```typescript
   * const tx = await gSwap.positions.createPool({
   *   token0: 'GALA|Unit|none|none', token1: 'GUSDC|Unit|none|none', fee: 3000,
   *   startingPrice: '0.15',
   * });
   * ```
   */
  async createPool(args: {
    token0: TokenRef;
    token1: TokenRef;
    fee: FEE_TIER;
    startingPrice?: NumericAmount | undefined;
    startingSqrtPrice?: NumericAmount | undefined;
    isPrivate?: boolean | undefined;
    privateAccess?: string[] | undefined;
  }) {
    const hasPrice = args.startingPrice !== undefined;
    const hasSqrtPrice = args.startingSqrtPrice !== undefined;
    if (hasPrice === hasSqrtPrice) {
      throw new GSwapSDKError(
        'Provide exactly one of startingPrice or startingSqrtPrice.',
        'VALIDATION_ERROR',
      );
    }
    validateFee(args.fee);
    const [tokenA, tokenB] = await Promise.all([
      this.resolveCreateToken(args.token0),
      this.resolveCreateToken(args.token1),
    ]);
    const flipped = tokenA.symbol > tokenB.symbol;
    const [token0, token1] = flipped ? [tokenB, tokenA] : [tokenA, tokenB];
    const sourcePriceInput = hasPrice
      ? (args.startingPrice as NumericAmount)
      : (args.startingSqrtPrice as NumericAmount);
    this.rejectNumber(sourcePriceInput, hasPrice ? 'startingPrice' : 'startingSqrtPrice');
    const sourcePrice = new BigNumber(sourcePriceInput);
    if (!sourcePrice.isFinite() || sourcePrice.isLessThanOrEqualTo(0)) {
      throw new GSwapSDKError('Starting price must be finite and positive.', 'VALIDATION_ERROR');
    }
    const canonicalPrice = flipped ? new BigNumber(1).dividedBy(sourcePrice) : sourcePrice;
    const dto: CreatePoolDTO = {
      token0Key: token0.classKey,
      token1Key: token1.classKey,
      token0Symbol: token0.symbol,
      token1Symbol: token1.symbol,
      fee: args.fee,
      uniqueKey: this.uniqueKey(),
      ...(hasPrice
        ? { startingPrice: canonicalPrice.toFixed() }
        : { startingSqrtPrice: canonicalPrice.toFixed() }),
      ...(args.isPrivate === undefined ? {} : { isPrivate: args.isPrivate }),
      ...(args.privateAccess === undefined ? {} : { privateAccess: args.privateAccess }),
    };
    const transaction = await this.submit('CreatePool', dto as unknown as Record<string, unknown>);
    this.symbols.invalidate?.();
    return transaction;
  }

  private async submit(
    method: string,
    dto: Record<string, unknown>,
    identity?: {
      token0: string;
      token1: string;
      fee: FEE_TIER;
      tickLower: number;
      tickUpper: number;
    },
  ) {
    if (this.signer === undefined) throw GSwapSDKError.noSignerError();
    const signed = await this.signer.signObject(method, dto);
    const submitOptions =
      this.walletAddress === undefined ? {} : { walletAddress: this.walletAddress };
    const owner = this.walletAddress;
    const options: ChainSubmitOptions = {
      ...submitOptions,
      ...(identity === undefined || owner === undefined
        ? {}
        : {
            positionConfirmation: (signal) => this.getPosition({ ...identity, owner }, signal),
          }),
    };
    return this.gateway.submit(method, signed, options);
  }

  private async get<TData>(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<BackendEnvelope<TData>> {
    return this.http.sendGetRequest<BackendEnvelope<TData>>(
      this.gateway.dexBackendBaseUrl,
      '/v2/trade',
      endpoint,
      params,
      signal === undefined ? undefined : { signal },
    );
  }

  private async getNullable<TData>(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<BackendEnvelope<TData> | null> {
    try {
      return await this.get<TData>(endpoint, params, signal);
    } catch (error: unknown) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    if (!(error instanceof GSwapSDKError) || error.details === undefined) return false;
    return error.details['status'] === 404;
  }

  private mapPosition(position: PositionWire): Position {
    return {
      token0Symbol: position.token0Symbol,
      token1Symbol: position.token1Symbol,
      ...(position.token0CompositeKey === undefined
        ? {}
        : { token0CompositeKey: position.token0CompositeKey }),
      ...(position.token1CompositeKey === undefined
        ? {}
        : { token1CompositeKey: position.token1CompositeKey }),
      fee: position.fee,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity,
      amount0: position.amount0,
      amount1: position.amount1,
      inRange: position.inRange,
      ...(position.currentTick === undefined ? {} : { currentTick: position.currentTick }),
      ...(position.sqrtPrice === undefined ? {} : { sqrtPrice: position.sqrtPrice }),
      pool: position.poolRef ?? position.pool ?? '',
      owner: position.owner,
      ...(position.fees0 === undefined ? {} : { fees0: position.fees0 }),
      ...(position.fees1 === undefined ? {} : { fees1: position.fees1 }),
    };
  }

  private requestToken(ref: TokenRef): string {
    return typeof ref === 'string' ? ref : compositeKeyOf(ref);
  }

  private canonicalTicks(tickLower: number, tickUpper: number, flipped: boolean) {
    return flipped ? { tickLower: -tickUpper, tickUpper: -tickLower } : { tickLower, tickUpper };
  }

  private tickSpacing(fee: number): number {
    if (fee === 0) return 200;
    if (fee === 500) return 10;
    if (fee === 3000) return 60;
    if (fee === 10000) return 200;
    throw new GSwapSDKError(`Unsupported fee tier: ${fee}.`, 'VALIDATION_ERROR');
  }

  private rejectNumber(value: unknown, parameterName: string): void {
    if (typeof value === 'number') {
      throw new GSwapSDKError(
        `Invalid ${parameterName}: use a decimal string or BigNumber, not a JavaScript number`,
        'VALIDATION_ERROR',
      );
    }
  }

  private uniqueKey(): string {
    return `gswap-sdk-${globalThis.crypto.randomUUID()}`;
  }

  private async resolveCreateToken(ref: TokenRef): Promise<ResolvedCreateToken> {
    try {
      const lookupRef = typeof ref === 'object' ? compositeKeyOf(ref) : ref;
      const resolved = await this.symbols.resolve(lookupRef);
      const suppliedClassKey = this.tryParseClassKey(ref);
      return {
        symbol: resolved.symbol,
        classKey:
          suppliedClassKey ??
          parseTokenClassKey({
            collection: resolved.collection,
            category: resolved.category,
            type: resolved.type,
            additionalKey: resolved.additionalKey,
          }),
      };
    } catch (error: unknown) {
      if (!(error instanceof GSwapSDKError) || error.code !== 'UNKNOWN_TOKEN') {
        throw error;
      }
      let classKey: ReturnType<typeof parseTokenClassKey>;
      try {
        classKey = parseTokenClassKey(ref);
      } catch {
        throw error;
      }
      return { symbol: classKey.collection, classKey };
    }
  }

  private tryParseClassKey(ref: TokenRef): ReturnType<typeof parseTokenClassKey> | undefined {
    try {
      return parseTokenClassKey(ref);
    } catch {
      return undefined;
    }
  }
}
