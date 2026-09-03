import { serialize, signatures } from '@gala-chain/api';
import { calculatePersonalSignPrefix } from '@gala-chain/connect';
import { GSwapSDKError } from './gswap_sdk_error.js';

/** The signing schemes supported by the Gala Wallet signer. */
export type GalaWalletScheme = 'native' | 'personal-sign';

/** The request surface used by an EIP-1193 browser wallet. */
export interface BrowserWalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface GalaWalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface WindowWithGala {
  gala?: GalaWalletProvider;
}

interface GlobalWithWindow {
  window?: WindowWithGala;
}

type SignedDto<T extends Record<string, unknown>> = T & { signature: string };

/**
 * A signer for complete GalaChain write bodies.
 *
 * Implementations return the DTO fields together with the signature that belongs in the
 * gateway request body. Signer identity is recovered from that signature; implementations do
 * not add signer hints, typed-data metadata, or a domain.
 */
export interface GalaChainSigner {
  /**
   * Signs a DTO for a named GalaChain contract method.
   *
   * @example
   * ```typescript
   * const signed = await signer.signObject('Trade', { token0: 'GALA', token1: 'GUSDC' });
   * ```
   */
  signObject<T extends Record<string, unknown>>(methodName: string, dto: T): Promise<SignedDto<T>>;
}

function getWalletProvider(): GalaWalletProvider {
  const globalObject = globalThis as GlobalWithWindow;
  const wallet = globalObject.window?.gala;
  if (!wallet) {
    throw new GSwapSDKError(
      'Gala wallet is not available. Please ensure the Gala wallet is connected.',
      'GALA_WALLET_NOT_AVAILABLE',
    );
  }
  return wallet;
}

function getSignature(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GSwapSDKError('Wallet returned an invalid signature.', 'INVALID_SIGNATURE');
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

function isUnsupportedNativeSchemeError(error: unknown): boolean {
  return /unsupported|unknown scheme|invalid params/i.test(getErrorMessage(error));
}

function personalSign<T extends Record<string, unknown>>(
  provider: GalaWalletProvider | BrowserWalletProvider,
  dto: T,
  walletAddress: string,
  methodName?: string,
): Promise<T & { prefix: string; signature: string }> {
  const prefix = calculatePersonalSignPrefix(dto);
  const payload = { ...dto, prefix };
  const params =
    methodName !== undefined
      ? [serialize(payload), walletAddress, methodName]
      : [serialize(payload), walletAddress];

  return provider
    .request({ method: methodName !== undefined ? 'gala_signChainDto' : 'personal_sign', params })
    .then((value) => ({ ...payload, signature: getSignature(value) }));
}

/**
 * A GalaChain native signer backed by a secp256k1 private key.
 *
 * Native signing resolves the registered `client|` alias on chain and produces the bare
 * GalaChain signature format, without a personal-sign prefix or EIP-712 metadata.
 */
export class PrivateKeySigner implements GalaChainSigner {
  private readonly keyBuffer: Buffer;

  /**
   * Creates a native signer from a hex or base64 secp256k1 private key.
   *
   * @example
   * ```typescript
   * const signer = new PrivateKeySigner('1'.padStart(64, '0'));
   * const signed = await signer.signObject('Trade', { token0: 'GALA', token1: 'GUSDC' });
   * ```
   */
  constructor(privateKey: string) {
    this.keyBuffer = signatures.normalizePrivateKey(privateKey);
  }

  /**
   * Signs the DTO with GalaChain native signing.
   *
   * @example
   * ```typescript
   * const signed = await signer.signObject('Trade', {
   *   token0: 'GALA',
   *   token1: 'GUSDC',
   *   fee: 3000,
   * });
   * ```
   */
  public signObject<T extends Record<string, unknown>>(
    _methodName: string,
    dto: T,
  ): Promise<SignedDto<T>> {
    const signature = signatures.getSignature(dto, this.keyBuffer);
    return Promise.resolve({ ...dto, signature });
  }
}

/**
 * A Gala Wallet signer using native GalaChain signing, with an opt-in personal-sign mode and
 * automatic fallback for older wallets.
 *
 * Native signing resolves the registered `client|` alias on chain. Personal-sign resolves the
 * bare `eth|` identity instead. The legacy EIP-712 `eth_signTypedData` path is not used.
 */
export class GalaWalletSigner implements GalaChainSigner {
  /** The wallet address supplied to Gala Wallet for each signing request. */
  public readonly walletAddress: string;

  /** The scheme currently used, including any automatic native-to-personal fallback. */
  public effectiveScheme: GalaWalletScheme;

  /**
   * Creates a Gala Wallet signer.
   *
   * @example
   * ```typescript
   * const signer = new GalaWalletSigner('client|alice');
   * const signed = await signer.signObject('Trade', { token0: 'GALA', token1: 'GUSDC' });
   * ```
   *
   * @param walletAddress - The registered Gala Wallet address.
   * @param options - Select native signing or personal-sign explicitly.
   */
  constructor(walletAddress: string, options: { scheme?: GalaWalletScheme } = {}) {
    this.walletAddress = walletAddress;
    this.effectiveScheme = options.scheme ?? 'native';
  }

  /**
   * Signs a DTO through `gala_signChainDto`.
   *
   * @example
   * ```typescript
   * const signed = await signer.signObject('AddLiquidity', {
   *   token0: 'GALA',
   *   token1: 'GUSDC',
   *   tickLower: -60,
   *   tickUpper: 60,
   * });
   * ```
   */
  public async signObject<T extends Record<string, unknown>>(
    methodName: string,
    dto: T,
  ): Promise<SignedDto<T>> {
    const wallet = getWalletProvider();

    if (this.effectiveScheme === 'personal-sign') {
      return personalSign(wallet, dto, this.walletAddress, methodName);
    }

    try {
      const signature = await wallet.request({
        method: 'gala_signChainDto',
        params: [serialize(dto), this.walletAddress, methodName, 'native'],
      });
      return { ...dto, signature: getSignature(signature) };
    } catch (error: unknown) {
      if (!isUnsupportedNativeSchemeError(error)) {
        throw error;
      }
      this.effectiveScheme = 'personal-sign';
      return personalSign(wallet, dto, this.walletAddress, methodName);
    }
  }
}

/**
 * A personal-sign signer for MetaMask and other EIP-1193 browser wallets.
 *
 * The chain recovers this signature using the EIP-191 wrap applied by the wallet to
 * `personal_sign`. This is the browser-wallet path used by the v2 frontend and resolves the
 * bare `eth|` identity.
 */
export class BrowserWalletSigner implements GalaChainSigner {
  /**
   * Creates a browser-wallet signer.
   *
   * @example
   * ```typescript
   * const signer = new BrowserWalletSigner(window.ethereum, 'eth|0x1234');
   * const signed = await signer.signObject('Trade', { token0: 'GALA', token1: 'GUSDC' });
   * ```
   */
  constructor(
    private readonly provider: BrowserWalletProvider,
    public readonly walletAddress: string,
  ) {}

  /**
   * Signs the prefixed DTO with the EIP-1193 `personal_sign` method.
   *
   * @example
   * ```typescript
   * const signed = await signer.signObject('Trade', {
   *   token0: 'GALA',
   *   token1: 'GUSDC',
   *   fee: 3000,
   * });
   * ```
   */
  public signObject<T extends Record<string, unknown>>(
    _methodName: string,
    dto: T,
  ): Promise<SignedDto<T>> {
    return personalSign(this.provider, dto, this.walletAddress);
  }
}
