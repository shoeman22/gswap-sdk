import { serialize, signatures } from '@gala-chain/api';
import { calculatePersonalSignPrefix } from '@gala-chain/connect';
import { expect } from 'chai';
import { BrowserWalletSigner, GalaWalletSigner, PrivateKeySigner } from '../src/classes/signers.js';

interface WalletRequest {
  method: string;
  params?: unknown[];
}

interface TestWindow {
  gala?: {
    request(args: WalletRequest): Promise<unknown>;
  };
}

const dto = {
  token0: 'GALA',
  token1: 'GUSDC',
  fee: 3000,
  uniqueKey: 'test-key',
};

const walletAddress = '0x0123456789012345678901234567890123456789';
const nativeSignature = 'a'.repeat(130);
const personalSignature = 'b'.repeat(130);

function installGalaWallet(request: (args: WalletRequest) => Promise<unknown>): WalletRequest[] {
  const requests: WalletRequest[] = [];
  const globalObject = globalThis as unknown as { window?: TestWindow };
  globalObject.window = {
    gala: {
      request: async (args) => {
        requests.push(args);
        return request(args);
      },
    },
  };
  return requests;
}

function removeGalaWallet(): void {
  const globalObject = globalThis as unknown as { window?: TestWindow };
  delete globalObject.window;
}

function rejectWithValue(value: unknown): Promise<never> {
  return new Promise((_, reject) => {
    Reflect.apply(reject, undefined, [value]);
  });
}

describe('signers', () => {
  afterEach(() => {
    removeGalaWallet();
  });

  describe('PrivateKeySigner', () => {
    it('creates a recoverable bare native signature and excludes it from the payload', async () => {
      const privateKey = '0000000000000000000000000000000000000000000000000000000000000001';
      const signer = new PrivateKeySigner(privateKey);

      const signed = await signer.signObject('Trade', dto);
      const signature = signed.signature;

      expect(signature).to.be.a('string').with.length(130);
      if (typeof signature !== 'string') {
        throw new Error('Expected a string signature');
      }
      expect(signatures.recoverPublicKey(signature, dto)).to.equal(
        signatures.getPublicKey(privateKey),
      );
      expect(signatures.getPayloadToSign(signed)).to.equal(serialize(dto));
      expect(signed).to.deep.equal({ ...dto, signature });
    });
  });

  describe('GalaWalletSigner', () => {
    it('reports unavailable wallets and invalid native signatures', async () => {
      const unavailable = await new GalaWalletSigner(walletAddress)
        .signObject('Trade', dto)
        .catch((error: unknown) => error);
      expect(unavailable).to.have.property('code', 'GALA_WALLET_NOT_AVAILABLE');

      installGalaWallet(async () => 42);
      const invalid = await new GalaWalletSigner(walletAddress)
        .signObject('Trade', dto)
        .catch((error: unknown) => error);
      expect(invalid).to.have.property('code', 'INVALID_SIGNATURE');

      installGalaWallet(async () => 'z'.repeat(130));
      const malformed = await new GalaWalletSigner(walletAddress)
        .signObject('Trade', dto)
        .catch((error: unknown) => error);
      expect(malformed).to.have.property('code', 'INVALID_SIGNATURE');

      installGalaWallet(async () => {
        const nonError: unknown = {};
        throw nonError;
      });
      const unexpectedResult = await new GalaWalletSigner(walletAddress)
        .signObject('Trade', dto)
        .catch((error: unknown) => error);
      expect(unexpectedResult).to.deep.equal({});
    });

    it('recognizes non-Error unsupported-scheme responses before fallback', async () => {
      const requests = installGalaWallet(async (request) => {
        if (request.params?.[3] === 'native')
          return Promise.reject(new Error('unsupported scheme'));
        return personalSignature;
      });
      const signed = await new GalaWalletSigner(walletAddress).signObject('Trade', dto);
      expect(requests).to.have.length(2);
      expect(signed.signature).to.equal(personalSignature);
    });

    it('uses native signing with the exact four-parameter request', async () => {
      const requests = installGalaWallet(async () => nativeSignature);
      const signer = new GalaWalletSigner(walletAddress);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'gala_signChainDto',
          params: [serialize(dto), walletAddress, 'Trade', 'native'],
        },
      ]);
      expect(signer.effectiveScheme).to.equal('native');
      expect(signed).to.deep.equal({ ...dto, signature: nativeSignature });
      expect(signed).not.to.have.property('prefix');
    });

    it('uses personal-sign when selected explicitly', async () => {
      const requests = installGalaWallet(async () => personalSignature);
      const signer = new GalaWalletSigner(walletAddress, { scheme: 'personal-sign' });
      const prefix = calculatePersonalSignPrefix(dto);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'gala_signChainDto',
          params: [serialize({ ...dto, prefix }), walletAddress, 'Trade'],
        },
      ]);
      expect(signed).to.deep.equal({ ...dto, prefix, signature: personalSignature });
    });

    it('falls back once to personal-sign for unsupported native schemes', async () => {
      const requests = installGalaWallet(async (request) => {
        if (request.params?.[3] === 'native') {
          throw new Error('unknown scheme');
        }
        return personalSignature;
      });
      const signer = new GalaWalletSigner(walletAddress);
      const prefix = calculatePersonalSignPrefix(dto);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'gala_signChainDto',
          params: [serialize(dto), walletAddress, 'Trade', 'native'],
        },
        {
          method: 'gala_signChainDto',
          params: [serialize({ ...dto, prefix }), walletAddress, 'Trade'],
        },
      ]);
      expect(signer.effectiveScheme).to.equal('personal-sign');
      expect(signed).to.deep.equal({ ...dto, prefix, signature: personalSignature });
    });

    it('normalizes the selected eth account and classifies non-Error fallback failures', async () => {
      const requests = installGalaWallet(async (request) => {
        if (request.params?.[3] === 'native') return rejectWithValue('unsupported scheme');
        return personalSignature;
      });
      const signer = new GalaWalletSigner(`eth|${walletAddress}`);
      await signer.signObject('Trade', dto);
      expect(requests[0]?.params?.[1]).to.equal(walletAddress);

      installGalaWallet(async (request) => {
        if (request.params?.[3] === 'native') return rejectWithValue({ message: 'unknown scheme' });
        return personalSignature;
      });
      await new GalaWalletSigner(walletAddress).signObject('Trade', dto);

      installGalaWallet(async (request) => {
        if (request.params?.[3] === 'native') return rejectWithValue({ message: 42 });
        return personalSignature;
      });
      const failed = await new GalaWalletSigner(walletAddress)
        .signObject('Trade', dto)
        .catch((error: unknown) => error);
      expect(failed).to.have.property('message', 42);
      expect(() => new GalaWalletSigner('not-an-ethereum-account')).to.throw(
        'selected Ethereum account',
      );
    });
  });

  describe('BrowserWalletSigner', () => {
    it('uses EIP-1193 personal_sign with the prefixed serialized DTO', async () => {
      const requests: WalletRequest[] = [];
      const provider = {
        request: async (request: WalletRequest): Promise<unknown> => {
          requests.push(request);
          return personalSignature;
        },
      };
      const signer = new BrowserWalletSigner(provider, walletAddress);
      const prefix = calculatePersonalSignPrefix(dto);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'personal_sign',
          params: [serialize({ ...dto, prefix }), walletAddress],
        },
      ]);
      expect(signed).to.deep.equal({ ...dto, prefix, signature: personalSignature });
    });

    it('rejects an invalid personal-sign result', async () => {
      const provider = { request: async (): Promise<unknown> => 42 };
      const error = await new BrowserWalletSigner(provider, walletAddress)
        .signObject('Trade', dto)
        .catch((caught: unknown) => caught);
      expect(error).to.have.property('code', 'INVALID_SIGNATURE');
    });
  });
});
