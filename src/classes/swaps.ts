import BigNumber from 'bignumber.js';
import type { NumericAmount } from '../types/amounts.js';
import type { ResolvedEnv } from '../types/env.js';
import { ALL_FEE_TIERS } from '../types/fees.js';
import type { TokenRef } from '../types/v2_dtos.js';
import { orderSymbols } from '../utils/ordering.js';
import { validateNumericAmount } from '../utils/validation.js';
import type { ChainGateway, SubmittedTransaction } from './gateway.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import { HttpClient } from './http_client.js';
import type { GalaChainSigner } from './signers.js';
import type { Symbols } from './symbols.js';

type SwapAmount =
  | { exactIn: NumericAmount; amountOutMinimum?: NumericAmount }
  | { exactOut: NumericAmount; amountInMaximum?: NumericAmount };

/** Executes current-contract Trade operations through the Chain Gateway. */
export class Swaps {
  /**
   * Creates a swap service.
   *
   * @example
   * ```ts
   * const swaps = new Swaps(gateway, symbols, http, urls, { signer });
   * ```
   */
  constructor(
    private readonly gateway: ChainGateway,
    private readonly symbols: Symbols,
    private readonly http: HttpClient,
    private readonly urls: ResolvedEnv,
    private readonly options: { signer?: GalaChainSigner; walletAddress?: string } = {},
  ) {}

  /**
   * Signs and submits an exact-input or exact-output Trade DTO.
   *
   * @example
   * ```ts
   * const submitted = await swaps.swap('GALA', 'GUSDC', 3000, {
   *   exactIn: '100',
   *   amountOutMinimum: '14',
   * });
   * ```
   */
  public async swap(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    fee: number,
    amount: SwapAmount,
    walletAddress?: string,
  ): Promise<SubmittedTransaction> {
    void this.http;
    void this.urls;
    void walletAddress;
    validateFee(fee);

    const dto = await this.buildTradeDto(tokenIn, tokenOut, fee, amount);
    const signer = this.options.signer;
    if (signer === undefined) throw GSwapSDKError.noSignerError();
    const signedDto = await signer.signObject('Trade', dto);
    return this.gateway.submit('Trade', signedDto);
  }

  private async buildTradeDto(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    fee: number,
    amount: SwapAmount,
  ): Promise<Record<string, unknown>> {
    const tokenInSymbol = await resolveSymbol(this.symbols, tokenIn);
    const tokenOutSymbol = await resolveSymbol(this.symbols, tokenOut);
    const ordered = readOrdering(orderSymbols(tokenInSymbol, tokenOutSymbol));
    const tokenInIsToken0 = tokenInSymbol === ordered.token0;

    const dto: Record<string, unknown> = {
      token0: ordered.token0,
      token1: ordered.token1,
      fee,
      uniqueKey: `gswap-sdk-${crypto.randomUUID()}`,
    };

    if ('exactIn' in amount) {
      validateNumericAmount(amount.exactIn, 'exactIn');
      dto[tokenInIsToken0 ? 'sell0Qty' : 'sell1Qty'] = toDecimalString(amount.exactIn);
      if (amount.amountOutMinimum !== undefined) {
        validateNumericAmount(amount.amountOutMinimum, 'amountOutMinimum', true);
        dto.amountOutMinimum = toDecimalString(amount.amountOutMinimum);
      }
    } else {
      validateNumericAmount(amount.exactOut, 'exactOut');
      dto[tokenInIsToken0 ? 'buy1Qty' : 'buy0Qty'] = toDecimalString(amount.exactOut);
      if (amount.amountInMaximum !== undefined) {
        validateNumericAmount(amount.amountInMaximum, 'amountInMaximum', true);
        dto.amountInMaximum = toDecimalString(amount.amountInMaximum);
      }
    }
    return dto;
  }
}

function validateFee(fee: number): void {
  if (!ALL_FEE_TIERS.some((tier) => tier === fee)) {
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

function readOrdering(value: unknown): { token0: string; token1: string } {
  if (Array.isArray(value) && value.length >= 2) {
    const token0 = value[0];
    const token1 = value[1];
    if (typeof token0 === 'string' && typeof token1 === 'string') return { token0, token1 };
  }
  if (typeof value === 'object' && value !== null) {
    const token0 = Reflect.get(value, 'token0');
    const token1 = Reflect.get(value, 'token1');
    if (typeof token0 === 'string' && typeof token1 === 'string') return { token0, token1 };
  }
  throw new GSwapSDKError('Unable to order trading symbols.', 'VALIDATION_ERROR');
}
