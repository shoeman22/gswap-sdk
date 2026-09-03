import BigNumber from 'bignumber.js';
import type { NumericAmount } from '../types/amounts.js';
import { ALL_FEE_TIERS } from '../types/fees.js';
import type { FEE_TIER } from '../types/fees.js';
import type { QuoteResult } from '../types/v2_results.js';
import type { TokenRef } from '../utils/ordering.js';
import { validateNumericAmount } from '../utils/validation.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import type { HttpClient } from './http_client.js';
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

type QuoteSymbols = Pick<Symbols, 'resolve'>;

/** Read-only quote service backed by the v2 offline quote engine. */
export class Quoting {
  /**
   * Creates a quote service.
   *
   * @example
   * ```ts
   * const quoting = new Quoting('https://swap-backend.stage.defi.ovh.gala.com', http, symbols);
   * ```
   */
  constructor(
    private readonly dexBackendBaseUrl: string,
    private readonly http: HttpClient,
    private readonly symbols: QuoteSymbols,
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
    fee?: FEE_TIER,
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
    fee?: FEE_TIER,
  ): Promise<QuoteResult> {
    validateNumericAmount(amountOut, 'amountOut');
    return this.quote(tokenIn, tokenOut, { amountOut: toDecimalString(amountOut) }, fee);
  }

  private async quote(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    amount: { amountIn: string } | { amountOut: string },
    fee?: FEE_TIER,
  ): Promise<QuoteResult> {
    validateOptionalFee(fee);

    const tokenInSymbol = await resolveSymbol(this.symbols, tokenIn);
    const tokenOutSymbol = await resolveSymbol(this.symbols, tokenOut);
    const params: Record<string, string> = {
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      ...amount,
    };
    if (fee !== undefined) params['fee'] = String(fee);

    try {
      const response = await this.http.sendGetRequest<BackendEnvelope<QuoteWire>>(
        this.dexBackendBaseUrl,
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

function mapQuote(value: unknown): QuoteResult {
  if (!isQuoteWire(value)) {
    throw new GSwapSDKError('Backend returned an invalid quote.', 'INVALID_CHAIN_RESPONSE', {
      data: value,
    });
  }
  const wire = value;
  const currentPrice =
    wire.currentPrice !== undefined
      ? new BigNumber(wire.currentPrice)
      : orientPrice(wire.currentSqrtPrice!, wire.tokenInIsToken0);
  const newPrice =
    wire.newPrice !== undefined
      ? new BigNumber(wire.newPrice)
      : orientPrice(wire.newSqrtPrice!, wire.tokenInIsToken0);
  const priceImpact = newPrice.minus(currentPrice).dividedBy(currentPrice);

  return {
    contractVersion: wire.contractVersion,
    fee: wire.fee,
    amountIn: wire.amountIn,
    amountOut: wire.amountOut,
    ...(wire.currentSqrtPrice === undefined ? {} : { currentSqrtPrice: wire.currentSqrtPrice }),
    ...(wire.newSqrtPrice === undefined ? {} : { newSqrtPrice: wire.newSqrtPrice }),
    feeTier: wire.fee,
    newTick: wire.newTick,
    tradingFees: wire.tradingFees,
    protocolFees: wire.protocolFees,
    totalFees: wire.totalFees,
    feeTokenSymbol: wire.feeTokenSymbol,
    token0Symbol: wire.token0Symbol,
    token1Symbol: wire.token1Symbol,
    tokenInIsToken0: wire.tokenInIsToken0,
    currentPrice,
    newPrice,
    priceImpact,
  };
}

function orientPrice(sqrtPrice: string, tokenInIsToken0: boolean): BigNumber {
  const poolPrice = new BigNumber(sqrtPrice).pow(2);
  return tokenInIsToken0 ? poolPrice : new BigNumber(1).dividedBy(poolPrice);
}

function isQuoteWire(value: unknown): value is QuoteWire {
  if (typeof value !== 'object' || value === null) return false;
  const wire = value as Record<string, unknown>;
  const requiredStrings = [
    'amountIn',
    'amountOut',
    'tradingFees',
    'protocolFees',
    'totalFees',
    'feeTokenSymbol',
    'token0Symbol',
    'token1Symbol',
  ];
  return (
    wire['contractVersion'] === 'v2' &&
    typeof wire['fee'] === 'number' &&
    Number.isFinite(wire['fee']) &&
    requiredStrings.every((key) => typeof wire[key] === 'string') &&
    typeof wire['newTick'] === 'number' &&
    Number.isInteger(wire['newTick']) &&
    typeof wire['tokenInIsToken0'] === 'boolean' &&
    optionalPositiveDecimal(wire['currentSqrtPrice']) &&
    optionalPositiveDecimal(wire['newSqrtPrice']) &&
    optionalPositiveDecimal(wire['currentPrice']) &&
    optionalPositiveDecimal(wire['newPrice']) &&
    (wire['currentSqrtPrice'] !== undefined || wire['currentPrice'] !== undefined) &&
    (wire['newSqrtPrice'] !== undefined || wire['newPrice'] !== undefined)
  );
}

function optionalPositiveDecimal(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      new BigNumber(value).isFinite() &&
      new BigNumber(value).isGreaterThan(0))
  );
}

function mapQuoteError(
  error: unknown,
  tokenIn: TokenRef,
  tokenOut: TokenRef,
  fee: FEE_TIER | undefined,
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
  const status = details?.['status'];
  return typeof status === 'number' ? status : undefined;
}

function readMessage(details: Record<string, unknown> | undefined): string | undefined {
  const direct = details?.['message'];
  if (typeof direct === 'string') return direct;
  const body = details?.['body'];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const message = (body as Record<string, unknown>)['message'];
  return typeof message === 'string' ? message : undefined;
}

function validateOptionalFee(fee: FEE_TIER | undefined): void {
  if (fee !== undefined && !ALL_FEE_TIERS.some((tier) => Number(tier) === Number(fee))) {
    throw new GSwapSDKError(`Invalid fee tier: ${fee}`, 'VALIDATION_ERROR', { fee });
  }
}

function toDecimalString(amount: NumericAmount): string {
  return new BigNumber(amount).toFixed();
}

async function resolveSymbol(symbols: QuoteSymbols, token: TokenRef): Promise<string> {
  const resolved = await symbols.resolve(token);
  if (resolved.symbol.length > 0) return resolved.symbol;
  throw new GSwapSDKError('Token could not be resolved to a trading symbol.', 'SYMBOL_NOT_FOUND', {
    token,
  });
}
