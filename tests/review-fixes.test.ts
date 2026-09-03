import { expect } from 'chai';
import { serialize, signatures } from '@gala-chain/api';
import { ChainGateway } from '../src/classes/gateway.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { HttpClient } from '../src/classes/http_client.js';
import { Positions } from '../src/classes/positions.js';
import { SubmittedTransaction } from '../src/classes/submitted_transaction.js';
import { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import type { NumericAmount, PriceIn } from '../src/types/amounts.js';
import type { GalaChainSigner } from '../src/classes/signers.js';
import type { TradingSymbol } from '../src/types/v2_results.js';
import { GC_MAX_TICK, GC_MIN_TICK, tickFromPrice, tickToSqrtPrice } from '../src/utils/ticks.js';
import { validateNumericAmount } from '../src/utils/validation.js';

const BASE = 'https://backend.example';

function response(body: unknown, status = 200, headers?: Record<string, string>): HTTPResponse {
  return new Response(JSON.stringify(body), {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
}

function gateway(requestor: HttpRequestor, timeoutMs = 30_000): ChainGateway {
  return new ChainGateway({
    dexBackendBaseUrl: BASE,
    httpRequestor: requestor,
    chainCallTimeoutMs: timeoutMs,
  });
}

const symbolsFixture: TradingSymbol[] = [
  {
    symbol: 'A',
    collection: 'A',
    category: 'Unit',
    type: 'none',
    additionalKey: 'none',
    decimals: 8,
  },
  {
    symbol: 'B',
    collection: 'B',
    category: 'Unit',
    type: 'none',
    additionalKey: 'none',
    decimals: 8,
  },
];

describe('adversarial review fixes', () => {
  it('matches backend tick math quickly at realistic and extreme ticks', () => {
    const fixtures: Array<[number, string]> = [
      [-19_149, '0.383888884829388'],
      [19_149, '2.604920432756026'],
      [-100_000, '0.006739631584094'],
      [100_000, '148.376062923074618'],
    ];
    for (const [tick, prefix] of fixtures) {
      const started = performance.now();
      const value = tickToSqrtPrice(tick);
      expect(performance.now() - started).to.be.lessThan(50);
      expect(value.toString().startsWith(prefix)).to.equal(true);
    }
    expect(tickToSqrtPrice(GC_MIN_TICK).isFinite()).to.equal(true);
    expect(tickToSqrtPrice(GC_MAX_TICK).isFinite()).to.equal(true);
  });

  it('matches backend boundary price-to-tick fixtures', () => {
    expect(
      tickFromPrice(
        '0.00000000000000000000000000000000000000293895680758558483887475486496883410884307817009650743204283',
      ),
    ).to.equal(GC_MIN_TICK);
    expect(tickFromPrice('340256786836388094050805785052946541066.751507546701582068884')).to.equal(
      GC_MAX_TICK,
    );
    expect(Number.isNaN(tickFromPrice('1e1000000'))).to.equal(true);
  });

  it('rejects JavaScript financial numbers before serialization', () => {
    const amount = (0.1 + 0.2) as unknown as NumericAmount;
    expect(() => validateNumericAmount(amount, 'amount')).to.throw(GSwapSDKError, 'decimal string');
  });

  it('validates every position write fee before symbol lookup or tick math', async () => {
    let symbolCalls = 0;
    const pair = {
      resolve: async (): Promise<TradingSymbol> => {
        symbolCalls += 1;
        return symbolsFixture[0]!;
      },
      orderPair: async () => {
        symbolCalls += 1;
        return { token0: symbolsFixture[0]!, token1: symbolsFixture[1]!, flipped: false };
      },
    };
    const signer: GalaChainSigner = {
      signObject: async <T extends Record<string, unknown>>(_method: string, dto: T) => ({
        ...dto,
        signature: 'signed',
      }),
    };
    const positions = new Positions(
      gateway(async () => response({})),
      pair,
      signer,
      'client|owner',
    );
    const cases = [
      () =>
        positions.addLiquidityByTicks({
          token0: 'A',
          token1: 'B',
          fee: 1 as never,
          tickLower: 0,
          tickUpper: 60,
          amount: '1',
          amountIsToken0: true,
        }),
      () =>
        positions.addLiquidityByPrice({
          token0: 'A',
          token1: 'B',
          fee: 1 as never,
          minPrice: '1' as PriceIn,
          maxPrice: '2' as PriceIn,
          amount: '1',
          amountIsToken0: true,
        }),
      () =>
        positions.removeLiquidity({
          token0: 'A',
          token1: 'B',
          fee: 1 as never,
          tickLower: 0,
          tickUpper: 60,
        }),
      () =>
        positions.collectPositionFees({
          token0: 'A',
          token1: 'B',
          fee: 1 as never,
          tickLower: 0,
          tickUpper: 60,
        }),
      () =>
        positions.createPool({
          token0: 'A|Unit|none|none',
          token1: 'B|Unit|none|none',
          fee: 1 as never,
          startingPrice: '1',
        }),
    ];
    for (const makeCase of cases) {
      const error = await makeCase().catch((caught: unknown) => caught);
      expect(error).to.be.instanceOf(GSwapSDKError);
      expect((error as GSwapSDKError).code).to.equal('VALIDATION_ERROR');
    }
    expect(symbolCalls).to.equal(0);
  });

  it('does not spin on pending explore when both transaction headers are known', async () => {
    let calls = 0;
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'known',
      transactionId: 'tx-known',
      blockNumber: 42,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => {
        calls += 1;
        return response(
          { error: true, message: 'No indexed transaction for that uniqueKey yet' },
          404,
        );
      },
    });
    expect(await transaction.confirm({ timeoutMs: 60_000, pollIntervalMs: 1 })).to.equal(null);
    expect(calls).to.equal(1);
  });

  it('continues polling when response metadata is absent', async () => {
    let calls = 0;
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'eventual',
      transactionId: null,
      blockNumber: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => {
        calls += 1;
        return calls === 1
          ? response({ error: true, message: 'No indexed transaction for that uniqueKey yet' }, 404)
          : response({ data: { transactionId: 'tx', blockNumber: 42 } });
      },
    });
    expect(await transaction.confirm({ timeoutMs: 2_000, pollIntervalMs: 500 })).to.deep.include({
      transactionId: 'tx',
    });
    expect(calls).to.equal(2);
  });

  it('times out a stalled backend request and preserves the unknown write outcome', async () => {
    const stalled: HttpRequestor = async (_url, options) =>
      new Promise<HTTPResponse>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    const error = await gateway(stalled, 10)
      .submit('Trade', { uniqueKey: 'uncertain' })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('SUBMISSION_OUTCOME_UNKNOWN');
  });

  it('rejects malformed synchronous gateway envelopes', async () => {
    const error = await gateway(async () =>
      response({ data: { mode: 'async', transactionId: 'tx' } }, 201),
    )
      .submit('Trade', { uniqueKey: 'bad' })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');
  });

  it('proves the pinned serializer keeps prefix in the signed payload', () => {
    const dto = { token0: 'A', uniqueKey: 'u', prefix: 'GalaChain|1' };
    expect(serialize(dto)).to.equal(signatures.getPayloadToSign(dto));
  });

  it('rejects an invalid backend symbol response while accepting an empty list', async () => {
    const invalid = new Symbols({
      httpRequestor: async () => response({ data: [{ symbol: 'A' }] }),
      dexBackendBaseUrl: BASE,
      requestTimeoutMs: 30_000,
    });
    const error = await invalid.list().catch((caught: unknown) => caught);
    expect((error as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');
    const malformedList = new Symbols({
      httpRequestor: async () => response({ data: { symbol: 'A' } }),
      dexBackendBaseUrl: BASE,
      requestTimeoutMs: 30_000,
    });
    const malformedError = await malformedList.list().catch((caught: unknown) => caught);
    expect((malformedError as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');
    const empty = new Symbols({
      httpRequestor: async () => response({ data: [] }),
      dexBackendBaseUrl: BASE,
      requestTimeoutMs: 30_000,
    });
    expect(await empty.list()).to.deep.equal([]);
  });

  it('propagates caller aborts through the backend HTTP client', async () => {
    const controller = new AbortController();
    const client = new HttpClient(
      async (_url, options) =>
        new Promise<HTTPResponse>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const pending = client.sendGetRequest(BASE, '', '', undefined, { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);
    expect((error as GSwapSDKError).code).to.equal('REQUEST_TIMEOUT');
  });
});
