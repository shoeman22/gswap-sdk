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

const walletAddress = 'client|alice';

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
    it('uses native signing with the exact four-parameter request', async () => {
      const requests = installGalaWallet(async () => 'native-signature');
      const signer = new GalaWalletSigner(walletAddress);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'gala_signChainDto',
          params: [serialize(dto), walletAddress, 'Trade', 'native'],
        },
      ]);
      expect(signer.effectiveScheme).to.equal('native');
      expect(signed).to.deep.equal({ ...dto, signature: 'native-signature' });
      expect(signed).not.to.have.property('prefix');
    });

    it('uses personal-sign when selected explicitly', async () => {
      const requests = installGalaWallet(async () => 'personal-signature');
      const signer = new GalaWalletSigner(walletAddress, { scheme: 'personal-sign' });
      const prefix = calculatePersonalSignPrefix(dto);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'gala_signChainDto',
          params: [serialize({ ...dto, prefix }), walletAddress, 'Trade'],
        },
      ]);
      expect(signed).to.deep.equal({ ...dto, prefix, signature: 'personal-signature' });
    });

    it('falls back once to personal-sign for unsupported native schemes', async () => {
      const requests = installGalaWallet(async (request) => {
        if (request.params?.[3] === 'native') {
          throw new Error('unknown scheme');
        }
        return 'fallback-signature';
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
      expect(signed).to.deep.equal({ ...dto, prefix, signature: 'fallback-signature' });
    });
  });

  describe('BrowserWalletSigner', () => {
    it('uses EIP-1193 personal_sign with the prefixed serialized DTO', async () => {
      const requests: WalletRequest[] = [];
      const provider = {
        request: async (request: WalletRequest): Promise<unknown> => {
          requests.push(request);
          return 'browser-signature';
        },
      };
      const signer = new BrowserWalletSigner(provider, 'eth|0xabc');
      const prefix = calculatePersonalSignPrefix(dto);

      const signed = await signer.signObject('Trade', dto);

      expect(requests).to.deep.equal([
        {
          method: 'personal_sign',
          params: [serialize({ ...dto, prefix }), 'eth|0xabc'],
        },
      ]);
      expect(signed).to.deep.equal({ ...dto, prefix, signature: 'browser-signature' });
    });
  });
});
