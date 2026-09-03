/** SDK deployment environment. */
export type GSwapEnv = 'prod' | 'stage';

/** Backend URL used by one SDK deployment environment. */
export interface GSwapEnvironmentConfig {
  dexBackendBaseUrl: string;
}

/** Built-in GalaSwap deployment environments. */
export const GSWAP_ENVIRONMENTS: Readonly<Record<GSwapEnv, GSwapEnvironmentConfig>> = {
  prod: {
    dexBackendBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
  },
  stage: {
    dexBackendBaseUrl: 'https://swap-backend.stage.defi.ovh.gala.com',
  },
};
