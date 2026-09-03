import BigNumber from 'bignumber.js';
import type { NumericAmount } from '../types/amounts.js';
import { ALL_FEE_TIERS } from '../types/fees.js';
import { orderSymbols, readOrderedSymbols, type TokenRef } from '../utils/ordering.js';
import { validateNumericAmount } from '../utils/validation.js';
import type { ChainGateway } from './gateway.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import type { GalaChainSigner } from './signers.js';
import type { SubmittedTransaction } from './submitted_transaction.js';
import type { Symbols } from './symbols.js';

type SwapAmount =
  | { exactIn: NumericAmount; amountOutMinimum?: NumericAmount }
  | { exactOut: NumericAmount; amountInMaximum?: NumericAmount };
type SwapGateway = Pick<ChainGateway, 'submit'>;
type SwapSymbols = Pick<Symbols, 'resolve'>;

/** Executes current-contract Trade operations through the Chain Gateway. */
export class Swaps {
  /**
   * Creates a swap service.
   *
   * @example
   * ```ts
   * const swaps = new Swaps(gateway, symbols, signer, 'client|alice');
   * ```
   */
  constructor(
    private readonly gateway: SwapGateway,
    private readonly symbols: SwapSymbols,
    private readonly signer?: GalaChainSigner,
    private readonly walletAddress?: string,
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
  ): Promise<SubmittedTransaction> {
    validateFee(fee);

    const dto = await this.buildTradeDto(tokenIn, tokenOut, fee, amount);
    if (this.signer === undefined) throw GSwapSDKError.noSignerError();
    const signedDto = await this.signer.signObject('Trade', dto);
    const submitOptions =
      this.walletAddress === undefined ? {} : { walletAddress: this.walletAddress };
    return this.gateway.submit('Trade', signedDto, submitOptions);
  }

  private async buildTradeDto(
    tokenIn: TokenRef,
    tokenOut: TokenRef,
    fee: number,
    amount: SwapAmount,
  ): Promise<Record<string, unknown>> {
    const tokenInSymbol = await resolveSymbol(this.symbols, tokenIn);
    const tokenOutSymbol = await resolveSymbol(this.symbols, tokenOut);
    const ordered = readOrderedSymbols(orderSymbols(tokenInSymbol, tokenOutSymbol));
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
        dto['amountOutMinimum'] = toDecimalString(amount.amountOutMinimum);
      }
    } else {
      validateNumericAmount(amount.exactOut, 'exactOut');
      dto[tokenInIsToken0 ? 'buy1Qty' : 'buy0Qty'] = toDecimalString(amount.exactOut);
      if (amount.amountInMaximum !== undefined) {
        validateNumericAmount(amount.amountInMaximum, 'amountInMaximum', true);
        dto['amountInMaximum'] = toDecimalString(amount.amountInMaximum);
      }
    }
    return dto;
  }
}

function validateFee(fee: number): void {
  if (!ALL_FEE_TIERS.some((tier) => Number(tier) === fee)) {
    throw new GSwapSDKError(`Invalid fee tier: ${fee}`, 'VALIDATION_ERROR', { fee });
  }
}

function toDecimalString(amount: NumericAmount): string {
  return new BigNumber(amount).toFixed();
}

async function resolveSymbol(symbols: SwapSymbols, token: TokenRef): Promise<string> {
  const resolved = await symbols.resolve(token);
  if (resolved.symbol.length > 0) return resolved.symbol;
  throw new GSwapSDKError('Token could not be resolved to a trading symbol.', 'SYMBOL_NOT_FOUND', {
    token,
  });
}
