import { expect } from 'chai';
import type { ChainGateway, SubmittedTransaction } from '../src/classes/gateway.js';
import { HttpClient } from '../src/classes/http_client.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { Swaps } from '../src/classes/swaps.js';
import { Symbols } from '../src/classes/symbols.js';
import type { GalaChainSigner } from '../src/classes/signers.js';
import type { ResolvedEnv } from '../src/types/env.js';
import type { TokenRef } from '../src/types/v2_dtos.js';

const TOKEN_A = 'AAA|Unit|none|none';
const TOKEN_B = 'BBB|Unit|none|none';
const signedResult = {
  transactionId: null,
  uniqueKey: 'gswap-sdk-test',
  result: { ok: true },
} as unknown as SubmittedTransaction;

function service(): {
  swaps: Swaps;
  submissions: Array<{ method: string; body: Record<string, unknown> }>;
  signed: Record<string, unknown>[];
} {
  const submissions: Array<{ method: string; body: Record<string, unknown> }> = [];
  const signed: Record<string, unknown>[] = [];
  const gateway = {
    submit: async (
      method: string,
      body: Record<string, unknown>,
    ): Promise<SubmittedTransaction> => {
      submissions.push({ method, body });
      return signedResult;
    },
  } as unknown as ChainGateway;
  const signer: GalaChainSigner = {
    signObject: async <T extends Record<string, unknown>>(
      _method: string,
      dto: T,
    ): Promise<T & { signature: string }> => {
      signed.push(dto);
      return { ...dto, signature: 'native-signature' };
    },
  };
  const symbols = {
    resolve: async (token: TokenRef): Promise<string> =>
      typeof token === 'string' && token.includes('|') ? (token.split('|')[0] ?? token) : token,
  } as unknown as Symbols;
  const swaps = new Swaps(
    gateway,
    symbols,
    new HttpClient(),
    { dexBackendBaseUrl: 'https://unused.example.test' } as ResolvedEnv,
    { signer },
  );
  return { swaps, submissions, signed };
}

describe('Swaps', () => {
  for (const [label, tokenIn, tokenOut, amount, field] of [
    ['exact-in token0', TOKEN_A, TOKEN_B, { exactIn: '10' }, 'sell0Qty'],
    ['exact-in token1', TOKEN_B, TOKEN_A, { exactIn: '10' }, 'sell1Qty'],
    ['exact-out token0', TOKEN_A, TOKEN_B, { exactOut: '10' }, 'buy1Qty'],
    ['exact-out token1', TOKEN_B, TOKEN_A, { exactOut: '10' }, 'buy0Qty'],
  ] as const) {
    it(`builds the v2 DTO for ${label}`, async () => {
      const { swaps, submissions, signed } = service();
      await swaps.swap(tokenIn, tokenOut, 0, amount);
      expect(submissions).to.have.length(1);
      expect(submissions[0]).to.include({ method: 'Trade' });
      expect(submissions[0]?.body).to.include({ token0: 'AAA', token1: 'BBB', fee: 0 });
      expect(submissions[0]?.body).to.have.property(field, '10');
      expect(
        Object.keys(submissions[0]?.body ?? {}).filter((key) => /Qty$/u.test(key)),
      ).to.deep.equal([field]);
      expect({ ...signed[0], signature: 'native-signature' }).to.deep.equal(submissions[0]?.body);
    });
  }

  it('preserves non-negative slippage bounds as decimal strings and appends the signer result', async () => {
    const { swaps, submissions } = service();
    await swaps.swap(TOKEN_A, TOKEN_B, 500, { exactIn: 10, amountOutMinimum: 0 });
    expect(submissions[0]?.body).to.include({ sell0Qty: '10', amountOutMinimum: '0' });
  });

  it('rejects unsupported fee tiers and missing signers', async () => {
    const { swaps } = service();
    const badFee = await swaps
      .swap(TOKEN_A, TOKEN_B, 1, { exactIn: '1' })
      .catch((error: unknown) => error);
    expect(badFee).to.be.instanceOf(GSwapSDKError);
    expect((badFee as GSwapSDKError).code).to.equal('VALIDATION_ERROR');
    const unsigned = new Swaps({} as ChainGateway, {} as Symbols, new HttpClient(), {
      dexBackendBaseUrl: 'https://unused.example.test',
    } as ResolvedEnv);
    const noSigner = await unsigned
      .swap(TOKEN_A, TOKEN_B, 500, { exactIn: '1' })
      .catch((error: unknown) => error);
    expect(noSigner).to.be.instanceOf(GSwapSDKError);
    expect((noSigner as GSwapSDKError).code).to.equal('NO_SIGNER');
  });
});
