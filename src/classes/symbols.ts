import type { GalaChainTokenClassKey } from '../types/token.js';
import type { TradingSymbol } from '../types/v2_results.js';
import type { TokenRef } from '../utils/ordering.js';
import { compositeKeyOf, orderSymbols, parseTokenClassKey } from '../utils/ordering.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import type { ChainGateway } from './gateway.js';
import { HttpClient } from './http_client.js';

const SYMBOL_CACHE_TTL_MS = 60_000;

/** Symbol registry client for the current GalaChainDex contract. */
export class Symbols {
  private cachedSymbols: TradingSymbol[] | undefined;
  private cachedAt = 0;
  private refreshInFlight: Promise<TradingSymbol[]> | undefined;

  private readonly http: HttpClient;

  /** Create a symbol service backed by the swap backend. */
  constructor(
    private readonly gateway: Pick<ChainGateway, 'httpRequestor' | 'dexBackendBaseUrl'> & {
      requestTimeoutMs?: number | undefined;
    },
  ) {
    this.http = new HttpClient(gateway.httpRequestor, gateway.requestTimeoutMs);
  }

  /** List all registered GalaChainDex trading symbols, cached for 60 seconds. */
  public async list(): Promise<TradingSymbol[]> {
    if (this.cachedSymbols !== undefined && Date.now() - this.cachedAt < SYMBOL_CACHE_TTL_MS) {
      return this.cachedSymbols;
    }
    if (this.refreshInFlight !== undefined) return this.refreshInFlight;
    this.refreshInFlight = this.http
      .sendGetRequest<{ data: unknown }>(this.gateway.dexBackendBaseUrl, '/v2/trade', '/symbols')
      .then((response) => parseSymbols(response.data))
      .then((symbols) => {
        this.cachedSymbols = symbols;
        this.cachedAt = Date.now();
        return symbols;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
    return this.refreshInFlight;
  }

  /** Invalidate the cached symbol registry after a write changes registration state.
   *
   * @example
   * ```ts
   * gSwap.symbols.invalidate();
   * ```
   */
  public invalidate(): void {
    this.cachedSymbols = undefined;
    this.cachedAt = 0;
  }

  /** Force one registry refresh, bypassing the cache.
   *
   * @example
   * ```ts
   * const symbols = await gSwap.symbols.refresh();
   * ```
   */
  public async refresh(): Promise<TradingSymbol[]> {
    this.invalidate();
    return this.list();
  }

  /** Resolve a symbol or token class key to its registered symbol metadata. */
  public async resolve(ref: TokenRef): Promise<TradingSymbol> {
    let symbols = await this.list();
    const composite =
      typeof ref === 'string'
        ? isCompositeKey(ref)
          ? compositeKeyOf(parseTokenClassKey(ref))
          : undefined
        : compositeKeyOf(ref);
    const resolved = symbols.find(
      (entry) =>
        entry.symbol === ref || (composite !== undefined && compositeKeyOf(entry) === composite),
    );
    if (resolved === undefined) {
      symbols = await this.refresh();
      const refreshed = symbols.find(
        (entry) =>
          entry.symbol === ref || (composite !== undefined && compositeKeyOf(entry) === composite),
      );
      if (refreshed === undefined) throw GSwapSDKError.unknownTokenError(ref);
      return refreshed;
    }
    return resolved;
  }

  /** Resolve and put two token references in canonical trading-symbol order. */
  public async orderPair(
    a: TokenRef,
    b: TokenRef,
  ): Promise<{
    token0: TradingSymbol;
    token1: TradingSymbol;
    flipped: boolean;
  }> {
    const [resolvedA, resolvedB] = await Promise.all([this.resolve(a), this.resolve(b)]);
    const [token0Symbol, token1Symbol] = orderSymbols(resolvedA.symbol, resolvedB.symbol);
    return {
      token0: token0Symbol === resolvedA.symbol ? resolvedA : resolvedB,
      token1: token1Symbol === resolvedB.symbol ? resolvedB : resolvedA,
      flipped: token0Symbol !== resolvedA.symbol,
    };
  }
}

function parseSymbols(value: unknown): TradingSymbol[] {
  if (!Array.isArray(value) || !value.every(isTradingSymbol)) {
    throw new GSwapSDKError('Backend returned an invalid symbol list.', 'INVALID_CHAIN_RESPONSE', {
      data: value,
    });
  }
  return value;
}

function isTradingSymbol(value: unknown): value is TradingSymbol {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['symbol'] === 'string' &&
    typeof entry['collection'] === 'string' &&
    typeof entry['category'] === 'string' &&
    typeof entry['type'] === 'string' &&
    typeof entry['additionalKey'] === 'string' &&
    typeof entry['decimals'] === 'number' &&
    Number.isInteger(entry['decimals']) &&
    entry['decimals'] >= 0
  );
}

function isCompositeKey(ref: string): boolean {
  return ref.includes('|') || ref.includes('$');
}

/** Alias exported for callers that use the contract's shorter type name. */
export type TokenClassKey = GalaChainTokenClassKey;
