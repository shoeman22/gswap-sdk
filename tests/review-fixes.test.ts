import { expect } from 'chai';
import { ChainGateway } from '../src/classes/gateway.js';
import { HttpClient } from '../src/classes/http_client.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { Positions } from '../src/classes/positions.js';
import { SubmittedTransaction } from '../src/classes/submitted_transaction.js';
import { Symbols } from '../src/classes/symbols.js';
import { GalaWalletSigner } from '../src/classes/signers.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import type { NumericAmount } from '../src/types/amounts.js';
import type { TradingSymbol } from '../src/types/v2_results.js';
import {
  GC_MAX_TICK,
  GC_MIN_TICK,
  sqrtPriceToTick,
  tickFromPrice,
  tickToSqrtPrice,
} from '../src/utils/ticks.js';
import { parseTokenClassKey } from '../src/utils/ordering.js';
import { validateNumericAmount } from '../src/utils/validation.js';
import { validatePriceValues } from '../src/utils/validation.js';

function response(body: unknown, status = 200): HTTPResponse {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('adversarial review fixes', () => {
  it('matches the backend Decimal tick fixture at boundaries', () => {
    const fixtures: Array<[string, number]> = [
      ['0.94176735869374806055', -600],
      ['1.06183336125284899183002282845706742872428200553666352410483', 600],
      ['0.941767358693748060545125703647421678284219903805002441075147', -600],
      [
        '0.00000000000000000000000000000000000000293895680758558483887475486496883410884307817009650743204283',
        GC_MIN_TICK,
      ],
      ['340256786836388094050805785052946541066.751507546701582068884', GC_MAX_TICK],
    ];
    for (const [price, expected] of fixtures) expect(tickFromPrice(price)).to.equal(expected);
  });

  it('rejects a JavaScript number as a financial input', () => {
    const amount = (0.1 + 0.2) as unknown as NumericAmount;
    expect(() => validateNumericAmount(amount, 'amount')).to.throw(
      GSwapSDKError,
      'use a decimal string',
    );
  });

  it('refreshes the symbol registry after a miss', async () => {
    let reads = 0;
    const gateway = {
      pageAll: async <T>(): Promise<T[]> => {
        reads += 1;
        const symbols: TradingSymbol[] =
          reads === 1
            ? []
            : [
                {
                  symbol: 'NEW',
                  collection: 'NEW',
                  category: 'Unit',
                  type: 'none',
                  additionalKey: 'none',
                  decimals: 8,
                },
              ];
        return symbols as unknown as T[];
      },
    };
    const symbols = new Symbols(gateway);
    expect((await symbols.resolve('NEW')).symbol).to.equal('NEW');
    expect(reads).to.equal(2);
  });

  it('invalidates the registry after createPool so create-then-add resolves immediately', async () => {
    const alpha = 'ALPHA|Unit|none|none';
    const beta = 'BETA|Unit|none|none';
    let registered = false;
    const calls: string[] = [];
    const symbols = [
      {
        symbol: 'ALPHA',
        collection: 'ALPHA',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 8,
      },
      {
        symbol: 'BETA',
        collection: 'BETA',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 8,
      },
    ];
    const requestor: HttpRequestor = async (url) => {
      calls.push(url);
      if (url.endsWith('/FetchTokenTradingSymbols')) {
        return response({ Status: 1, Data: { results: registered ? symbols : [] } });
      }
      if (url.endsWith('/CreatePool')) {
        registered = true;
        return response({ data: { transactionId: 'create', mode: 'sync', result: {} } }, 201);
      }
      if (url.endsWith('/AddLiquidity')) {
        return response({ data: { transactionId: 'add', mode: 'sync', result: {} } }, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: requestor,
    });
    const symbolService = new Symbols(gateway);
    const signer = {
      signObject: async <T extends Record<string, unknown>>(_method: string, dto: T) => ({
        ...dto,
        signature: 'signed',
      }),
    };
    const positions = new Positions(gateway, symbolService, signer, 'client|owner');
    await positions.createPool({ token0: alpha, token1: beta, fee: 3000, startingPrice: '1' });
    const added = await positions.addLiquidityByTicks({
      token0: alpha,
      token1: beta,
      fee: 3000,
      tickLower: -60,
      tickUpper: 60,
      amount: '1',
      amountIsToken0: true,
    });
    expect(added.transactionId).to.equal('add');
    expect(calls.filter((url) => url.endsWith('/FetchTokenTradingSymbols')).length).to.equal(3);
  });

  it('confirms a liquidity write by rereading its canonical position identity', async () => {
    const symbol = {
      symbol: 'A',
      collection: 'A',
      category: 'Unit',
      type: 'none',
      additionalKey: 'none',
      decimals: 8,
    };
    const other = {
      symbol: 'B',
      collection: 'B',
      category: 'Unit',
      type: 'none',
      additionalKey: 'none',
      decimals: 8,
    };
    const requestor: HttpRequestor = async (url) => {
      if (url.endsWith('/AddLiquidity'))
        return response({ data: { transactionId: 'add', mode: 'sync', result: {} } }, 201);
      if (url.includes('/v2/trade/position?')) {
        return response({
          data: {
            pool: 'A$B$3000',
            token0Symbol: 'A',
            token1Symbol: 'B',
            token0CompositeKey: 'A$Unit$none$none',
            token1CompositeKey: 'B$Unit$none$none',
            fee: 3000,
            owner: 'client|owner',
            tickLower: -60,
            tickUpper: 60,
            liquidity: '1',
            amount0: '1',
            amount1: '2',
            inRange: true,
          },
        });
      }
      if (url.endsWith('/FetchTokenTradingSymbols'))
        return response({ Status: 1, Data: { results: [symbol, other] } });
      throw new Error(`Unexpected request ${url}`);
    };
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: requestor,
    });
    const symbols = new Symbols(gateway);
    const signer = {
      signObject: async <T extends Record<string, unknown>>(_method: string, dto: T) => ({
        ...dto,
        signature: 'signed',
      }),
    };
    const positions = new Positions(gateway, symbols, signer, 'client|owner');
    const transaction = await positions.addLiquidityByTicks({
      token0: 'A',
      token1: 'B',
      fee: 3000,
      tickLower: -60,
      tickUpper: 60,
      amount: '1',
      amountIsToken0: true,
    });
    const confirmed = await transaction.confirm({ timeoutMs: 1_000, pollIntervalMs: 500 });
    expect(confirmed).to.deep.include({
      owner: 'client|owner',
      token0Symbol: 'A',
      token1Symbol: 'B',
      tickLower: -60,
      tickUpper: 60,
    });
  });

  it('reads a real Response body once for non-JSON gateway errors', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => new Response('upstream exploded', { status: 502 }),
    });
    const error = await gateway.chainRead('FetchPools', {}).catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('HTTP_ERROR');
    expect((error as GSwapSDKError).message).to.equal('upstream exploded');
  });

  it('rejects a successful submission without an explicit sync data envelope', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response({ data: { transactionId: 'tx-only' } }),
    });
    const error = await gateway
      .submit('Trade', { uniqueKey: 'u' })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');
  });

  it('rejects a successful submission whose body is not an envelope object', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response(null),
    });
    const error = await gateway
      .submit('Trade', { uniqueKey: 'null-body' })
      .catch((caught: unknown) => caught);
    expect((error as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');
  });

  it('reports a string HTTP error body with the upstream text', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response('bad envelope', 502),
    });
    const error = await gateway.chainRead('FetchPools', {}).catch((caught: unknown) => caught);
    expect((error as GSwapSDKError).code).to.equal('HTTP_ERROR');
    expect((error as GSwapSDKError).message).to.include('bad envelope');
  });

  it('fails repeated pagination bookmarks instead of looping', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () =>
        response({ Status: 1, Data: { results: [], nextPageBookmark: 'same' } }),
    });
    const error = await gateway.pageAll('FetchPools').catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');
  });

  it('enforces the page cap', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () =>
        response({ Status: 1, Data: { results: [], nextPageBookmark: 'next' } }),
    });
    const error = await gateway
      .pageAll('FetchPools', {}, { maxPages: 1 })
      .catch((caught: unknown) => caught);
    expect((error as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');
  });

  it('rejects malformed native wallet signatures locally', async () => {
    const globalObject = globalThis as unknown as {
      window?: {
        gala?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      };
    };
    globalObject.window = { gala: { request: async () => 'not-a-signature' } };
    const signer = new GalaWalletSigner('0x0000000000000000000000000000000000000001');
    const error = await signer
      .signObject('Trade', { uniqueKey: 'u' })
      .catch((caught: unknown) => caught);
    delete globalObject.window;
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('INVALID_SIGNATURE');
  });

  it('recognizes a framework missing-route body as confirmation failure', async () => {
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'u',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () =>
        new Response(JSON.stringify({ message: 'Cannot GET /explore/transaction?uniqueKey=u' }), {
          status: 404,
        }),
    });
    const error = await transaction
      .confirm({ timeoutMs: 1_000, pollIntervalMs: 500 })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');
  });

  it('honors Retry-After on a temporary confirmation rate limit', async () => {
    let calls = 0;
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'rate-limited',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => {
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ error: true, message: 'slow down' }), {
              status: 429,
              headers: { 'Retry-After': '0' },
            })
          : new Response(JSON.stringify({ data: { transactionId: 'tx' } }), { status: 200 });
      },
    });
    expect(await transaction.confirm({ timeoutMs: 1_000, pollIntervalMs: 500 })).to.deep.include({
      transactionId: 'tx',
    });
    expect(calls).to.equal(2);
  });

  it('times out when Retry-After exceeds the confirmation deadline', async () => {
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'late-retry',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () =>
        new Response(JSON.stringify({ error: true }), {
          status: 429,
          headers: { 'Retry-After': '2' },
        }),
    });
    const error = await transaction
      .confirm({ timeoutMs: 1, pollIntervalMs: 500 })
      .catch((caught: unknown) => caught);
    expect((error as GSwapSDKError).code).to.equal('CONFIRMATION_TIMEOUT');
  });

  it('reports malformed confirmation envelopes and position confirmation timeouts', async () => {
    const malformed = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'malformed',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response(null),
    });
    const malformedError = await malformed.confirm().catch((caught: unknown) => caught);
    expect((malformedError as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');

    const position = new SubmittedTransaction({
      method: 'AddLiquidity',
      uniqueKey: 'position-timeout',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response({}),
      positionConfirmation: async () => null,
    });
    const timeout = await position
      .confirm({ timeoutMs: 1, pollIntervalMs: -1 })
      .catch((caught: unknown) => caught);
    expect((timeout as GSwapSDKError).code).to.equal('CONFIRMATION_TIMEOUT');
  });

  it('passes abort signals to reads', async () => {
    let sawSignal = false;
    const requestor: HttpRequestor = async (_url, options) => {
      sawSignal = options?.signal !== undefined;
      return response({ Status: 1, Data: {} });
    };
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: requestor,
    });
    const gatewayWithTimeout = gateway as unknown as {
      chainRead(method: string, dto: unknown, options: { timeoutMs: number }): Promise<unknown>;
    };
    await gatewayWithTimeout.chainRead('FetchPools', {}, { timeoutMs: 10 });
    expect(sawSignal).to.equal(true);
    await gateway.chainRead('FetchPools', {}, { signal: new AbortController().signal });
  });

  it('supports caller abort signals and rejects numeric price inputs', async () => {
    let sawSignal = false;
    const controller = new AbortController();
    const client = new HttpClient(async (_url, options) => {
      sawSignal = options?.signal !== undefined;
      return response({ ok: true });
    });
    await client.sendGetRequest('https://backend.example', '', '', undefined, {
      signal: controller.signal,
    });
    expect(sawSignal).to.equal(true);
    expect(() => validatePriceValues(1 as never, '1', '2')).to.throw(
      GSwapSDKError,
      'JavaScript numbers',
    );
  });

  it('exercises Decimal tick correction around a square-root boundary', () => {
    const boundary = tickFromPrice('1.006017734268818595');
    expect(boundary).to.equal(60);
    expect(Number.isNaN(tickFromPrice({} as never))).to.equal(true);
    expect(Number.isNaN(tickFromPrice('1e1000000'))).to.equal(true);
  });

  it('distinguishes timed-out writes from a confirmed rejection and aborts confirmation fetches', async () => {
    const stalled: HttpRequestor = async (_url, options) =>
      new Promise<HTTPResponse>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: stalled,
      chainCallTimeoutMs: 10,
    });
    const submissionError = await gateway
      .submit('Trade', { uniqueKey: 'uncertain' })
      .catch((caught: unknown) => caught);
    expect(submissionError).to.be.instanceOf(GSwapSDKError);
    expect((submissionError as GSwapSDKError).code).to.equal('SUBMISSION_OUTCOME_UNKNOWN');
    expect((submissionError as GSwapSDKError).details?.['uniqueKey']).to.equal('uncertain');

    const confirmation = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'confirm-timeout',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: stalled,
      requestTimeoutMs: 10,
    });
    const confirmationError = await confirmation
      .confirm({ timeoutMs: 100, pollIntervalMs: 500 })
      .catch((caught: unknown) => caught);
    expect(confirmationError).to.be.instanceOf(GSwapSDKError);
    expect((confirmationError as GSwapSDKError).code).to.equal('REQUEST_TIMEOUT');
  });

  it('keeps the HttpClient response body available as parsed JSON', async () => {
    const client = new HttpClient(async () => response({ data: { ok: true } }));
    expect(
      await client.sendGetRequest<{ data: { ok: boolean } }>('https://backend.example', '', ''),
    ).to.deep.equal({ data: { ok: true } });
  });

  it('rethrows non-timeout submission transport failures and handles record retry headers', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway.example',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => {
        throw new Error('offline');
      },
    });
    const transportError = await gateway
      .submit('Trade', { uniqueKey: 'offline' })
      .catch((caught: unknown) => caught);
    expect(transportError).to.be.instanceOf(Error);
    expect((transportError as Error).message).to.equal('offline');

    let calls = 0;
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'record-retry',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => {
        calls += 1;
        return calls === 1
          ? {
              ok: false,
              status: 429,
              headers: { 'Retry-After': '0' },
              json: async () => ({ error: true }),
              text: async () => JSON.stringify({ error: true }),
            }
          : response({ data: { transactionId: 'tx' } });
      },
    });
    expect(await transaction.confirm({ timeoutMs: 1_000, pollIntervalMs: 500 })).to.deep.include({
      transactionId: 'tx',
    });
  });

  it('covers tick correction loops and strict class-key validation', () => {
    const sqrt = tickToSqrtPrice(60);
    expect(sqrtPriceToTick(sqrt)).to.equal(60);
    expect(sqrtPriceToTick(sqrt.multipliedBy('1.00001'))).to.equal(60);
    expect(sqrtPriceToTick(sqrt.dividedBy('1.00001'))).to.equal(59);
    expect(() => parseTokenClassKey('A|B|C|')).to.throw('four non-empty parts');
  });

  it('aborts an in-flight request from the caller and polls positions with backoff', async () => {
    const controller = new AbortController();
    const client = new HttpClient(
      async (_url, options) =>
        new Promise<HTTPResponse>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('caller aborted')), {
            once: true,
          });
        }),
    );
    const pending = client
      .sendGetRequest('https://backend.example', '', '', undefined, { signal: controller.signal })
      .catch((error: unknown) => error);
    controller.abort();
    const abortError = await pending;
    expect((abortError as GSwapSDKError).code).to.equal('REQUEST_TIMEOUT');

    const position = new SubmittedTransaction({
      method: 'RemoveLiquidity',
      uniqueKey: 'position-backoff',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response({}),
      positionConfirmation: async () => null,
    });
    const timeout = await position
      .confirm({ timeoutMs: 1_100, pollIntervalMs: -1 })
      .catch((caught: unknown) => caught);
    expect((timeout as GSwapSDKError).code).to.equal('CONFIRMATION_TIMEOUT');
  });
});
