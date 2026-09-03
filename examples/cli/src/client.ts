import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

export type FeeTier = 0 | 500 | 3000 | 10000;

/** Returns the requested SDK environment, defaulting CLI calls to staging. */
export function getEnvironment(): 'prod' | 'stage' {
  return process.env['GSWAP_ENV'] === 'prod' ? 'prod' : 'stage';
}

/** Creates a read-only SDK client for the selected environment. */
export function createReadClient(): GSwap {
  return new GSwap({ env: getEnvironment() });
}

/** Creates a signing SDK client from the CLI key and wallet environment variables. */
export function createWriteClient(): GSwap {
  const privateKey = process.env['GALACHAIN_PRIVATE_KEY'];
  const walletAddress = process.env['GALACHAIN_ADDRESS'];
  if (!privateKey || !walletAddress) {
    throw new Error('Set GALACHAIN_PRIVATE_KEY and GALACHAIN_ADDRESS before running a write.');
  }

  return new GSwap({
    env: getEnvironment(),
    signer: new PrivateKeySigner(privateKey),
    walletAddress,
  });
}

/** Parses an optional fee tier accepted by the v2 contract. */
export function parseFee(value: string | undefined): FeeTier | undefined {
  if (value === undefined) return undefined;
  const fee = Number(value);
  if (![0, 500, 3000, 10000].includes(fee)) {
    throw new Error('Fee must be one of 0, 500, 3000, or 10000.');
  }
  return fee as FeeTier;
}

/** Prints an example result without losing nested response fields. */
export function printResult(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
}
