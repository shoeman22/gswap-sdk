import BigNumber from 'bignumber.js';
import type { NumericAmount } from '../types/amounts.js';
import type { ResolvedEnv } from '../types/env.js';
import { ALL_FEE_TIERS } from '../types/fees.js';
import type { TokenRef } from '../types/v2_dtos.js';
import type { QuoteResult } from '../types/v2_results.js';
import { validateNumericAmount } from '../utils/validation.js';
import type { ChainGateway } from './gateway.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import { HttpClient } from './http_client.js';
import type { Symbols } from './symbols.js';

interface QuoteWire {
  contractVersion: 'v2';
  fee: number;
  amountIn: string;
  amountOut: string;
  currentSqrtPrice?: string;
  newSqrtPrice?: string;
  currentPrice?: string;
  newPrice?: string;
  newTick: number;
  tradingFees: string;
  protocolFees: string;
  totalFees: string;
  feeTokenSymbol: string;
  token0Symbol: string;
  token1Symbol: string;
  tokenInIsToken0: boolean;
}

interface BackendEnvelope<T> {
  data: T;
}

/** Read-only quote service backed by the v2 offline quote engine. */
export class Quoting {
  /**
   * Creates a quote service.
   *
   * @example
   * ```ts
   * const quoting = new Quoting(gateway, symbols, http, urls);
   * ```
   */
  constructor(
    private readonly gateway: ChainGateway,
    private readonly symbols: Symbols,
    private readonly http: HttpClient,
    private readonly urls: ResolvedEnv,
  ) {}

  /**
   * Quotes the output for a positive exact-input amount.
   *
   * @example
   * ```ts
   * const quote = await quoting.quoteExactInput('GALA', 'GUSDC', '100');
   * console.log(quote.amountOut);
   * ```
   */
  public async quoteExactInput(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    amountIn: NumericAmount,
    fee?: number,
  ): Promise<QuoteResult> {
    validateNumericAmount(amountIn, 'amountIn');
    return this.quote(tokenIn, tokenOut, { amountIn: toDecimalString(amountIn) }, fee);
  }

  /**
   * Quotes the input for a positive exact-output amount.
   *
   * @example
   * ```ts
   * const quote = await quoting.quoteExactOutput('GALA', 'GUSDC', '10', 3000);
   * console.log(quote.amountIn);
   * ```
   */
  public async quoteExactOutput(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    amountOut: NumericAmount,
    fee?: number,
  ): Promise<QuoteResult> {
    validateNumericAmount(amountOut, 'amountOut');
    return this.quote(tokenIn, tokenOut, { amountOut: toDecimalString(amountOut) }, fee);
  }

  private async quote(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    amount: { amountIn: string } | { amountOut: string },
    fee?: number,
  ): Promise<QuoteResult> {
    void this.gateway;
    validateOptionalFee(fee);

    const tokenInSymbol = await resolveSymbol(this.symbols, tokenIn);
    const tokenOutSymbol = await resolveSymbol(this.symbols, tokenOut);
    const params: Record<string, string> = {
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      ...amount,
    };
    if (fee !== undefined) params.fee = String(fee);

    try {
      const response = await this.http.sendGetRequest<BackendEnvelope<QuoteWire>>(
        this.urls.dexBackendBaseUrl,
        '/v2/trade',
        '/quote',
        params,
      );
      return mapQuote(response.data);
    } catch (error: unknown) {
      throw mapQuoteError(error, tokenIn, tokenOut, fee);
    }
  }
}

function mapQuote(wire: QuoteWire): QuoteResult {
  const currentPrice =
    wire.currentPrice !== undefined
      ? new BigNumber(wire.currentPrice)
      : orientPrice(wire.currentSqrtPrice, wire.tokenInIsToken0);
  const newPrice =
    wire.newPrice !== undefined
      ? new BigNumber(wire.newPrice)
      : orientPrice(wire.newSqrtPrice, wire.tokenInIsToken0);
  const priceImpact = newPrice.minus(currentPrice).dividedBy(currentPrice);

  return {
    ...wire,
    feeTier: wire.fee,
    currentPrice,
    newPrice,
    priceImpact,
  } as QuoteResult;
}

function orientPrice(sqrtPrice: string | undefined, tokenInIsToken0: boolean): BigNumber {
  if (sqrtPrice === undefined) return new BigNumber(NaN);
  const poolPrice = new BigNumber(sqrtPrice).pow(2);
  return tokenInIsToken0 ? poolPrice : new BigNumber(1).dividedBy(poolPrice);
}

function mapQuoteError(
  error: unknown,
  tokenIn: TokenRef,
  tokenOut: TokenRef,
  fee: number | undefined,
): GSwapSDKError {
  if (error instanceof GSwapSDKError) {
    const status = readStatus(error.details);
    const message = readMessage(error.details) ?? error.message;
    if (status === 404 || /no pool|no pools|pool does not exist/iu.test(message)) {
      return GSwapSDKError.noPoolAvailableError(tokenIn, tokenOut, fee);
    }
    if (status === 400 && /insufficient liquidity/iu.test(message)) {
      return GSwapSDKError.insufficientLiquidityError(tokenIn, tokenOut, fee);
    }
    return error;
  }
  return new GSwapSDKError('Quote request failed.', 'HTTP_ERROR', {
    cause: error,
    tokenIn,
    tokenOut,
    fee,
  });
}

function readStatus(details: Record<string, unknown> | undefined): number | undefined {
  const status = details?.status;
  return typeof status === 'number' ? status : undefined;
}

function readMessage(details: Record<string, unknown> | undefined): string | undefined {
  const direct = details?.message;
  if (typeof direct === 'string') return direct;
  const body = details?.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const message = Reflect.get(body, 'message');
  return typeof message === 'string' ? message : undefined;
}

function validateOptionalFee(fee: number | undefined): void {
  if (fee !== undefined && !ALL_FEE_TIERS.some((tier) => tier === fee)) {
    throw new GSwapSDKError(`Invalid fee tier: ${fee}`, 'VALIDATION_ERROR', { fee });
  }
}

function toDecimalString(amount: NumericAmount): string {
  return new BigNumber(amount).toFixed();
}

async function resolveSymbol(symbols: Symbols, token: TokenRef): Promise<string> {
  const resolved: unknown = await symbols.resolve(token);
  if (typeof resolved === 'string') return resolved;
  if (typeof resolved === 'object' && resolved !== null && 'symbol' in resolved) {
    const symbol = Reflect.get(resolved, 'symbol');
    if (typeof symbol === 'string' && symbol.length > 0) return symbol;
  }
  throw new GSwapSDKError('Token could not be resolved to a trading symbol.', 'SYMBOL_NOT_FOUND', {
    token,
  });
}
