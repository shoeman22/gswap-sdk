/** SDK deployment environment. */
export type GSwapEnv = 'prod' | 'stage';

/** URLs and contract paths used by one SDK deployment environment. */
export interface GSwapEnvironmentConfig {
  gatewayBaseUrl: string;
  dexContractBasePath: '/api/asset/dex-contract';
  tokenContractBasePath: '/api/asset/token-contract';
  dexBackendBaseUrl: string;
}

/** Built-in GalaSwap deployment environments. */
export const GSWAP_ENVIRONMENTS: Readonly<Record<GSwapEnv, GSwapEnvironmentConfig>> = {
  prod: {
    gatewayBaseUrl: 'https://gateway-mainnet.galachain.com',
    dexContractBasePath: '/api/asset/dex-contract',
    tokenContractBasePath: '/api/asset/token-contract',
    dexBackendBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
  },
  stage: {
    gatewayBaseUrl: 'https://gateway-testnet.galachain.com',
    dexContractBasePath: '/api/asset/dex-contract',
    tokenContractBasePath: '/api/asset/token-contract',
    dexBackendBaseUrl: 'https://swap-backend.stage.defi.ovh.gala.com',
  },
};
