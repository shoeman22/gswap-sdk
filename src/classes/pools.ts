import { ALL_FEE_TIERS } from '../types/fees.js';
import type { CompositePool, PoolInfo, Slot0 } from '../types/v2_results.js';
import { orderSymbols, readOrderedSymbols, type TokenRef } from '../utils/ordering.js';
import type { ChainGateway } from './gateway.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import { HttpClient } from './http_client.js';
import type { Symbols } from './symbols.js';

interface PoolPage {
  results?: PoolInfo[];
  nextPageBookmark?: string;
}

interface BackendEnvelope<T> {
  data: T;
}

type PoolGateway = Pick<ChainGateway, 'chainRead' | 'httpRequestor' | 'dexBackendBaseUrl'>;
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
    this.http = new HttpClient(gateway.httpRequestor);
  }

  private readonly http: HttpClient;

  /**
   * Fetches every current-contract pool, following chain bookmarks.
   *
   * @example
   * ```ts
   * const pools = await service.getPools();
   * console.log(pools.length);
   * ```
   */
  public async getPools(): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];
    let bookmark: string | undefined;
    do {
      const body = bookmark === undefined ? {} : { bookmark };
      const page = await this.gateway.chainRead<PoolPage>('FetchPools', body);
      pools.push(...(page.results ?? []));
      bookmark = page.nextPageBookmark;
    } while (bookmark !== undefined && bookmark !== '');
    return pools;
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
  public async getPool(token0: TokenRef, token1: TokenRef, fee: number): Promise<PoolInfo> {
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
  public async getSlot0(token0: TokenRef, token1: TokenRef, fee: number): Promise<Slot0> {
    validateFee(fee);
    return this.getBackend<Slot0>('/slot0', await this.backendParams(token0, token1, fee));
  }

  /**
   * Fetches the complete chain composite pool snapshot, in canonical symbol order.
   *
   * @example
   * ```ts
   * const composite = await service.getCompositePool('GALA', 'GUSDC', 3000);
   * console.log(composite.positions.length);
   * ```
   */
  public async getCompositePool(
    token0: TokenRef,
    token1: TokenRef,
    fee: number,
  ): Promise<CompositePool> {
    validateFee(fee);
    const first = await resolveSymbol(this.symbols, token0);
    const second = await resolveSymbol(this.symbols, token1);
    const ordered = readOrderedSymbols(orderSymbols(first, second));
    return this.gateway.chainRead<CompositePool>('FetchCompositePoolData', {
      token0: ordered.token0,
      token1: ordered.token1,
      fee,
    });
  }

  private async backendParams(
    token0: TokenRef,
    token1: TokenRef,
    fee: number,
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

function validateFee(fee: number): void {
  if (!ALL_FEE_TIERS.some((tier) => Number(tier) === fee)) {
    throw new GSwapSDKError(`Invalid fee tier: ${fee}`, 'VALIDATION_ERROR', { fee });
  }
}

async function resolveSymbol(symbols: PoolSymbols, token: TokenRef): Promise<string> {
  const resolved = await symbols.resolve(token);
  if (resolved.symbol.length > 0) return resolved.symbol;
  throw new GSwapSDKError('Token could not be resolved to a trading symbol.', 'SYMBOL_NOT_FOUND', {
    token,
  });
}
