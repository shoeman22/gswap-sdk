import { Assets } from './assets.js';
import { ChainGateway } from './gateway.js';
import { HttpClient } from './http_client.js';
import { Pools } from './pools.js';
import { Positions } from './positions.js';
import { Quoting } from './quoting.js';
import { GalaChainSigner } from './signers.js';
import { Symbols } from './symbols.js';
import { Swaps } from './swaps.js';
import type { HttpRequestor } from '../types/http_requestor.js';
import { GSWAP_ENVIRONMENTS, GSwapEnv } from '../types/env.js';

/** Main entry point for the current GalaChainDex SDK. */
export class GSwap {
  public readonly gatewayBaseUrl: string;
  public readonly dexContractBasePath: '/api/asset/dex-contract';
  public readonly tokenContractBasePath: '/api/asset/token-contract';
  public readonly dexBackendBaseUrl: string;
  public readonly chainCallTimeoutMs: number;
  public readonly signer: GalaChainSigner | undefined;
  public readonly walletAddress: string | undefined;
  public readonly gateway: ChainGateway;
  public readonly symbols: Symbols;
  public readonly quoting: Quoting;
  public readonly pools: Pools;
  public readonly positions: Positions;
  public readonly swaps: Swaps;
  public readonly assets: Assets;

  /**
   * Create an SDK client for prod or stage.
   *
   * @example
   * ```typescript
   * const gSwap = new GSwap({ env: 'stage' });
   * const symbols = await gSwap.symbols.list();
   * ```
   */
  constructor(options?: {
    signer?: GalaChainSigner;
    walletAddress?: string;
    env?: GSwapEnv;
    gatewayBaseUrl?: string;
    dexBackendBaseUrl?: string;
    httpRequestor?: HttpRequestor;
    chainCallTimeoutMs?: number;
  }) {
    const environment = GSWAP_ENVIRONMENTS[options?.env ?? 'prod'];
    this.gatewayBaseUrl = trimTrailingSlash(options?.gatewayBaseUrl ?? environment.gatewayBaseUrl);
    this.dexContractBasePath = environment.dexContractBasePath;
    this.tokenContractBasePath = environment.tokenContractBasePath;
    this.dexBackendBaseUrl = trimTrailingSlash(
      options?.dexBackendBaseUrl ?? environment.dexBackendBaseUrl,
    );
    this.chainCallTimeoutMs = options?.chainCallTimeoutMs ?? 30_000;
    this.signer = options?.signer;
    this.walletAddress = options?.walletAddress;

    const httpClient = new HttpClient(options?.httpRequestor);
    this.gateway = new ChainGateway({
      gatewayBaseUrl: this.gatewayBaseUrl,
      dexContractBasePath: this.dexContractBasePath,
      dexBackendBaseUrl: this.dexBackendBaseUrl,
      chainCallTimeoutMs: this.chainCallTimeoutMs,
      ...(options?.httpRequestor === undefined ? {} : { httpRequestor: options.httpRequestor }),
      ...(this.walletAddress === undefined ? {} : { walletAddress: this.walletAddress }),
    });
    this.symbols = new Symbols(this.gateway);
    this.quoting = new Quoting(this.dexBackendBaseUrl, httpClient, this.symbols);
    this.pools = new Pools(this.gateway, this.symbols);
    this.positions = new Positions(this.gateway, this.symbols, this.signer, this.walletAddress);
    this.swaps = new Swaps(this.gateway, this.symbols, this.signer, this.walletAddress);
    this.assets = new Assets(this.dexBackendBaseUrl, httpClient);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/u, '');
}
