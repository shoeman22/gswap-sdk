import type { FEE_TIER } from '../types/fees.js';
import type { CompositePool, PoolInfo, Slot0 } from '../types/v2_results.js';
import { orderSymbols, readOrderedSymbols, type TokenRef } from '../utils/ordering.js';
import type { ChainGateway } from './gateway.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import { HttpClient } from './http_client.js';
import type { Symbols } from './symbols.js';
import { validateFee } from '../utils/validation.js';

interface BackendEnvelope<T> {
  data: T;
}

type PoolGateway = Pick<ChainGateway, 'httpRequestor' | 'dexBackendBaseUrl'> & {
  requestTimeoutMs?: number | undefined;
};
type PoolSymbols = Pick<Symbols, 'resolve'>;

/** Read-only pool and current-price access for the current GalaChainDex contract. */
export class Pools {
  /**
   * Creates a pool service.
   *
   * @example
   * ```ts
   * const pools = new Pools(gateway, symbols);
   * ```
   */
  constructor(
    private readonly gateway: PoolGateway,
    private readonly symbols: PoolSymbols,
  ) {
    this.http = new HttpClient(gateway.httpRequestor, gateway.requestTimeoutMs ?? 30_000);
  }

  private readonly http: HttpClient;

  /**
   * Fetches every current-contract pool from the swap backend.
   *
   * @example
   * ```ts
   * const pools = await service.getPools();
   * console.log(pools.length);
   * ```
   */
  public async getPools(options?: { signal?: AbortSignal | undefined }): Promise<PoolInfo[]> {
    const response = await this.http.sendGetRequest<BackendEnvelope<unknown>>(
      this.gateway.dexBackendBaseUrl,
      '/v2/trade',
      '/pools',
      undefined,
      options?.signal === undefined ? undefined : { signal: options.signal },
    );
    if (!Array.isArray(response.data)) {
      throw new GSwapSDKError('Backend returned an invalid pool list.', 'INVALID_CHAIN_RESPONSE', {
        data: response.data,
      });
    }
    return response.data as PoolInfo[];
  }

  /**
   * Fetches one pool from the backend, preserving whether the request order was flipped.
   *
   * @example
   * ```ts
   * const pool = await service.getPool('GUSDC', 'GALA', 3000);
   * console.log(pool.flippedFromRequest);
   * ```
   */
  public async getPool(token0: TokenRef, token1: TokenRef, fee: FEE_TIER): Promise<PoolInfo> {
    validateFee(fee);
    return this.getBackend<PoolInfo>('/pool', await this.backendParams(token0, token1, fee));
  }

  /**
   * Fetches the current sqrt price, price, and tick for one pool.
   *
   * @example
   * ```ts
   * const slot0 = await service.getSlot0('GALA', 'GUSDC', 3000);
   * console.log(slot0.tick);
   * ```
   */
  public async getSlot0(token0: TokenRef, token1: TokenRef, fee: FEE_TIER): Promise<Slot0> {
    validateFee(fee);
    return this.getBackend<Slot0>('/slot0', await this.backendParams(token0, token1, fee));
  }

  /**
   * Fetches the complete chain composite pool snapshot, in canonical symbol order.
   *
   * @example
   * ```ts
   * const composite = await service.getCompositePool('GALA', 'GUSDC', 3000);
   * console.log(composite.positions?.length ?? 0);
   * ```
   */
  public async getCompositePool(
    token0: TokenRef,
    token1: TokenRef,
    fee: FEE_TIER,
  ): Promise<CompositePool> {
    validateFee(fee);
    const first = await resolveSymbol(this.symbols, token0);
    const second = await resolveSymbol(this.symbols, token1);
    const ordered = readOrderedSymbols(orderSymbols(first, second));
    return this.getBackend<CompositePool>('/composite-pool', {
      token0: ordered.token0,
      token1: ordered.token1,
      fee: String(fee),
    });
  }

  private async backendParams(
    token0: TokenRef,
    token1: TokenRef,
    fee: FEE_TIER,
  ): Promise<Record<string, string>> {
    return {
      token0: await resolveSymbol(this.symbols, token0),
      token1: await resolveSymbol(this.symbols, token1),
      fee: String(fee),
    };
  }

  private async getBackend<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    try {
      const response = await this.http.sendGetRequest<BackendEnvelope<T>>(
        this.gateway.dexBackendBaseUrl,
        '/v2/trade',
        endpoint,
        params,
      );
      return response.data;
    } catch (error: unknown) {
      if (error instanceof GSwapSDKError) throw error;
      throw new GSwapSDKError('Pool request failed.', 'HTTP_ERROR', { cause: error });
    }
  }
}

async function resolveSymbol(symbols: PoolSymbols, token: TokenRef): Promise<string> {
  const resolved = await symbols.resolve(token);
  if (resolved.symbol.length > 0) return resolved.symbol;
  throw new GSwapSDKError('Token could not be resolved to a trading symbol.', 'SYMBOL_NOT_FOUND', {
    token,
  });
}
