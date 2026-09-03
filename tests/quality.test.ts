import { expect } from 'chai';
import { Assets } from '../src/classes/assets.js';
import { ChainGateway } from '../src/classes/gateway.js';
import { GSwap } from '../src/classes/gswap.js';
import {
  GSwapSDKError,
  getObjectProperty,
  getStringProperty,
  parseJson,
} from '../src/classes/gswap_sdk_error.js';
import { HttpClient } from '../src/classes/http_client.js';
import { SubmittedTransaction } from '../src/classes/submitted_transaction.js';
import { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import { FEE_TIER } from '../src/types/fees.js';
import {
  alignTickDown,
  alignTickUp,
  assertTickRange,
  sqrtPriceToTick,
  tickFromPrice,
  tickToSqrtPrice,
} from '../src/utils/ticks.js';
import {
  compositeKeyOf,
  orderSymbols,
  parseTokenClassKey,
  readOrderedSymbols,
} from '../src/utils/ordering.js';
import '../src/index.js';

const BASE = 'https://quality.example.test';
const KEY = 'GALA|Unit|none|none';

function makeResponse(
  body: unknown,
  status = 200,
  options: { jsonFails?: boolean; headers?: HTTPResponse['headers'] } = {},
): HTTPResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: options.jsonFails
      ? async () => {
          throw new Error('not json');
        }
      : async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  };
}

function gateway(requestor: HttpRequestor): ChainGateway {
  return new ChainGateway({
    gatewayBaseUrl: `${BASE}/gateway/`,
    dexContractBasePath: 'api/asset/dex-contract/',
    dexBackendBaseUrl: `${BASE}/backend/`,
    httpRequestor: requestor,
  });
}

describe('quality boundaries', () => {
  it('covers SDK construction, HTTP methods, and asset validation/mapping', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const requestor: HttpRequestor = async (url, options) => {
      calls.push({
        url,
        method: options?.method ?? 'GET',
        ...(typeof options?.body === 'string' ? { body: options.body } : {}),
      });
      return makeResponse({
        status: 200,
        error: false,
        data: {
          token: [
            {
              image: '',
              name: 'Gala',
              decimals: '18',
              verify: true,
              symbol: 'GALA',
              quantity: '1',
            },
          ],
          count: 1,
        },
      });
    };
    const http = new HttpClient(requestor);
    expect(await http.sendPostRequest(BASE, '/post', '', { ok: true })).to.deep.equal({
      status: 200,
      error: false,
      data: {
        token: [
          { image: '', name: 'Gala', decimals: '18', verify: true, symbol: 'GALA', quantity: '1' },
        ],
        count: 1,
      },
    });
    const failingClient = new HttpClient(async () =>
      makeResponse({ error: { ErrorKey: 'BAD_REQUEST', Message: 'bad request' } }, 400),
    );
    const httpError = await failingClient
      .sendGetRequest(BASE, '/error', '')
      .catch((error: unknown) => error);
    expect((httpError as GSwapSDKError).code).to.equal('BAD_REQUEST');
    const plainError = await new HttpClient(async () => makeResponse('plain', 400))
      .sendGetRequest(BASE, '/error', '')
      .catch((error: unknown) => error);
    expect((plainError as GSwapSDKError).code).to.equal('HTTP_ERROR');
    const assets = new Assets(BASE, http);
    expect(await assets.getUserAssets('eth|alice')).to.deep.include({ count: 1 });
    expect(calls[1]).to.deep.include({
      url: `${BASE}/user/assets?address=eth%7Calice&page=1&limit=10`,
      method: 'GET',
    });
    const invalidPage = await assets.getUserAssets('eth|alice', 0).catch((error: unknown) => error);
    expect(invalidPage).to.have.property('message').that.includes('positive integer');
    const invalidLimit = await assets
      .getUserAssets('eth|alice', 1, 101)
      .catch((error: unknown) => error);
    expect(invalidLimit).to.have.property('message').that.includes('between 1 and 100');
    const emptyAssets = new Assets(
      BASE,
      new HttpClient(async () => makeResponse({ data: { token: [], count: 0 } })),
    );
    expect(await emptyAssets.getUserAssets('eth|alice')).to.deep.equal({ tokens: [], count: 0 });

    const client = new GSwap({
      env: 'stage',
      gatewayBaseUrl: `${BASE}/gateway/`,
      dexBackendBaseUrl: `${BASE}/backend/`,
      httpRequestor: requestor,
      chainCallTimeoutMs: 123,
    });
    expect(client.gatewayBaseUrl).to.equal(`${BASE}/gateway`);
    expect(client.dexBackendBaseUrl).to.equal(`${BASE}/backend`);
    expect(client.chainCallTimeoutMs).to.equal(123);
    expect(client.assets).to.be.instanceOf(Assets);
    const defaultClient = new GSwap({ walletAddress: 'client|alice' });
    expect(defaultClient.gatewayBaseUrl).to.equal('https://gateway-mainnet.galachain.com');
    expect(new GSwap().gatewayBaseUrl).to.equal('https://gateway-mainnet.galachain.com');
  });

  it('maps every gateway bounce code and HTTP response shape', async () => {
    const codes = [
      'METHOD_NOT_ALLOWED',
      'SIGNATURE_INVALID',
      'SIGNER_MISMATCH',
      'DTO_INVALID',
      'BOUNDS_VIOLATION',
      'SYMBOL_CONFLICT',
      'CHAIN_DISPATCH_FAILED',
    ];
    for (const code of codes) {
      const error = await gateway(async () => makeResponse({ code, message: 'rejected' }, 400))
        .submit('Trade', { uniqueKey: code })
        .catch((caught: unknown) => caught);
      expect(error).to.be.instanceOf(GSwapSDKError);
      expect((error as GSwapSDKError).code).to.equal(code);
    }
    const rateLimit = await gateway(async () =>
      makeResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429, {
        headers: { 'Retry-After': '60' },
      }),
    )
      .submit('Trade', { uniqueKey: 'limited' })
      .catch((caught: unknown) => caught);
    expect((rateLimit as GSwapSDKError).retryAfterMs).to.equal(60_000);
    const missingRetry = makeResponse({ code: 'RATE_LIMITED', message: 'slow down' }, 429);
    delete missingRetry.headers;
    const missingRetryError = await gateway(async () => missingRetry)
      .submit('Trade', { uniqueKey: 'missing-retry' })
      .catch((caught: unknown) => caught);
    expect((missingRetryError as GSwapSDKError).retryAfterMs).to.equal(undefined);
    const invalidRetry = await gateway(async () =>
      makeResponse({ code: 'RATE_LIMITED', message: 'slow down' }, 429, {
        headers: { get: () => 'invalid' },
      }),
    )
      .submit('Trade', { uniqueKey: 'invalid-retry' })
      .catch((caught: unknown) => caught);
    expect((invalidRetry as GSwapSDKError).retryAfterMs).to.equal(undefined);

    const httpError = await gateway(async () => makeResponse('plain failure', 500))
      .submit('Trade', { uniqueKey: 'http' })
      .catch((caught: unknown) => caught);
    expect((httpError as GSwapSDKError).code).to.equal('HTTP_ERROR');
    const malformed = await gateway(async () =>
      makeResponse('plain failure', 500, { jsonFails: true }),
    )
      .submit('Trade', { uniqueKey: 'malformed' })
      .catch((caught: unknown) => caught);
    expect((malformed as GSwapSDKError).code).to.equal('HTTP_ERROR');

    const invalidMode = await gateway(async () =>
      makeResponse({ data: { mode: 'async', transactionId: 'tx' } }, 201),
    )
      .submit('Trade', { uniqueKey: 'mode' })
      .catch((caught: unknown) => caught);
    expect((invalidMode as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');

    const successful = await gateway(async () =>
      makeResponse({ data: { transactionId: 'tx-1', mode: 'sync', result: null } }, 201),
    ).submit('Trade', {});
    expect(successful.transactionId).to.equal('tx-1');
    const fallbackSuccess = await gateway(async () =>
      makeResponse({ transactionId: 'tx-2', mode: 'sync', result: null }, 201),
    ).submit('Trade', { uniqueKey: 'with-override' }, { walletAddress: 'client|override' });
    expect(fallbackSuccess.transactionId).to.equal('tx-2');
    const nullRetry = await gateway(async () =>
      makeResponse({ code: 'RATE_LIMITED', message: 'slow down' }, 429, {
        headers: { get: () => null },
      }),
    )
      .submit('Trade', { uniqueKey: 'null-retry' })
      .catch((caught: unknown) => caught);
    expect((nullRetry as GSwapSDKError).retryAfterMs).to.equal(undefined);
    const chainHttpError = await gateway(async () => makeResponse('chain unavailable', 503))
      .chainRead('FetchPools', {})
      .catch((caught: unknown) => caught);
    expect((chainHttpError as GSwapSDKError).code).to.equal('HTTP_ERROR');
    const noMessageChain = await gateway(async () => makeResponse({ Status: 0 }))
      .chainRead('FetchPools', {})
      .catch((caught: unknown) => caught);
    expect((noMessageChain as GSwapSDKError).code).to.equal('CHAIN_ERROR');
  });

  it('unwraps chain error envelopes, malformed responses, arrays, and bookmarks', async () => {
    const nested = await gateway(async () =>
      makeResponse({ error: { ErrorKey: 'NESTED', Message: 'nested failure' } }),
    )
      .chainRead('FetchPools', {})
      .catch((caught: unknown) => caught);
    expect((nested as GSwapSDKError).code).to.equal('NESTED');

    const statusOnly = await gateway(async () => makeResponse({ Status: 0, Message: 'failed' }))
      .chainRead('FetchPools', {})
      .catch((caught: unknown) => caught);
    expect((statusOnly as GSwapSDKError).code).to.equal('CHAIN_ERROR');

    const invalid = await gateway(async () => makeResponse({ Status: 2 }))
      .chainRead('FetchPools', {})
      .catch((caught: unknown) => caught);
    expect((invalid as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');
    expect(
      await gateway(async () => makeResponse({ Status: 1, data: { lower: true } })).chainRead(
        'FetchPools',
        {},
      ),
    ).to.deep.equal({ lower: true });

    let calls = 0;
    const paged = gateway(async () => {
      calls += 1;
      return calls === 1
        ? makeResponse({ Status: 1, Data: [{ value: 1 }] })
        : makeResponse({ Status: 1, Data: { value: 2 } });
    });
    expect(await paged.pageAll<{ value: number }>('FetchPools')).to.deep.equal([{ value: 1 }]);
    expect(await paged.pageAll<{ value: number }>('FetchPools')).to.deep.equal([]);
    expect(
      await gateway(async () =>
        makeResponse({ Status: 1, Data: { nextPageBookmark: '' } }),
      ).pageAll('FetchPools'),
    ).to.deep.equal([]);
  });

  it('handles transaction confirmation outcomes and error helpers', async () => {
    const nonTrade = new SubmittedTransaction({
      method: 'AddLiquidity',
      uniqueKey: 'liquidity',
      transactionId: 'tx',
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({}),
    });
    expect(await nonTrade.confirm()).to.equal(null);

    const missingRoute = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'missing',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({ Message: 'route missing' }, 404),
    });
    const routeError = await missingRoute
      .confirm({ timeoutMs: 1, pollIntervalMs: 0 })
      .catch((error: unknown) => error);
    expect((routeError as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');
    const noMessage = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'no-message',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({}, 404),
    });
    const noMessageError = await noMessage
      .confirm({ timeoutMs: 1, pollIntervalMs: 0 })
      .catch((error: unknown) => error);
    expect((noMessageError as GSwapSDKError).message).to.equal('Transaction confirmation failed');

    const textResponse = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'text',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () =>
        makeResponse('{"transactionId":"tx-text"}', 200, { jsonFails: true }),
    });
    expect(await textResponse.confirm()).to.equal('{"transactionId":"tx-text"}');

    expect(GSwapSDKError.noSignerError().code).to.equal('NO_SIGNER');
    expect(GSwapSDKError.noPoolAvailableError('A', 'B').code).to.equal('NO_POOL_AVAILABLE');
    expect(GSwapSDKError.insufficientLiquidityError('A', 'B', 0).details?.['fee']).to.equal(0);
    expect(
      GSwapSDKError.unknownTokenError({
        collection: 'A',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
      }).code,
    ).to.equal('UNKNOWN_TOKEN');
    expect(GSwapSDKError.confirmationTimeoutError('timeout').details?.['uniqueKey']).to.equal(
      'timeout',
    );
    expect(GSwapSDKError.incorrectTokenOrderingError('B', 'A').code).to.equal(
      'INCORRECT_TOKEN_ORDERING',
    );
    expect(getObjectProperty({ nested: { ok: true } }, 'nested')).to.deep.equal({ ok: true });
    expect(getObjectProperty({ nested: null }, 'nested')).to.equal(undefined);
    expect(getStringProperty({ value: 'ok' }, 'value')).to.equal('ok');
    expect(getStringProperty({ value: 1 }, 'value')).to.equal(undefined);
    expect(parseJson('{"ok":true}')).to.deep.equal({ ok: true });
    expect(parseJson('invalid')).to.equal(undefined);
  });

  it('covers symbol cache expiry, key formats, and ordering guards', async () => {
    let calls = 0;
    const service = new Symbols({
      pageAll: async <T>(_method: string, _dto?: Record<string, unknown>): Promise<T[]> => {
        void _method;
        void _dto;
        calls += 1;
        const symbols = [
          {
            symbol: 'GALA',
            collection: 'GALA',
            category: 'Unit',
            type: 'none',
            additionalKey: 'none',
            decimals: 18,
          },
          {
            symbol: 'GUSDC',
            collection: 'GUSDC',
            category: 'Unit',
            type: 'none',
            additionalKey: 'none',
            decimals: 6,
          },
        ];
        return symbols as unknown as T[];
      },
    });
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      const first = service.list();
      const second = service.list();
      expect(await first).to.have.length(2);
      expect(await second).to.have.length(2);
      expect(await service.resolve('GALA$Unit$none$none')).to.have.property('symbol', 'GALA');
      expect(
        await service.resolve({
          collection: 'GUSDC',
          category: 'Unit',
          type: 'none',
          additionalKey: 'none',
        }),
      ).to.have.property('decimals', 6);
      expect(await service.orderPair('GALA', 'GUSDC')).to.include({ flipped: false });
      now += 60_001;
      await service.list();
      expect(calls).to.equal(2);
      const unknown = await service.resolve('UNKNOWN').catch((error: unknown) => error);
      expect((unknown as GSwapSDKError).code).to.equal('UNKNOWN_TOKEN');
    } finally {
      Date.now = originalNow;
    }
  });

  it('covers ordering and tick boundaries, including negative alignment', () => {
    const token = { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' };
    expect(compositeKeyOf(token)).to.equal('GALA$Unit$none$none');
    expect(parseTokenClassKey(token)).to.deep.equal(token);
    expect(parseTokenClassKey(KEY)).to.deep.equal(token);
    expect(parseTokenClassKey('GALA$Unit$none$none')).to.deep.equal(token);
    expect(() => parseTokenClassKey('invalid')).to.throw('four non-empty parts');
    expect(orderSymbols('B', 'A')).to.deep.equal(['A', 'B']);
    expect(readOrderedSymbols({ token0: 'A', token1: 'B' })).to.deep.equal({
      token0: 'A',
      token1: 'B',
    });
    expect(() => readOrderedSymbols(['A'])).to.throw('Unable to order');
    expect(() => readOrderedSymbols([undefined, 'B'])).to.throw('Unable to order');
    expect(alignTickDown(-1, 10)).to.equal(-10);
    expect(alignTickUp(-1, 10)).to.equal(0);
    expect(Number.isNaN(sqrtPriceToTick(0))).to.equal(true);
    expect(Number.isNaN(sqrtPriceToTick('not-a-number'))).to.equal(true);
    expect(Number.isNaN(tickFromPrice(0))).to.equal(true);
    expect(Number.isNaN(tickFromPrice(Infinity))).to.equal(true);
    const tick = 60;
    expect(sqrtPriceToTick(tickToSqrtPrice(tick))).to.equal(tick);
    expect(sqrtPriceToTick(tickToSqrtPrice(tick).times('1.00006'))).to.equal(61);
    expect(sqrtPriceToTick(tickToSqrtPrice(tick).dividedBy('1.00001'))).to.equal(59);
    expect(tickFromPrice(tickToSqrtPrice(20).pow(2))).to.equal(20);
    expect(Number.isNaN(tickFromPrice('1e1000000'))).to.equal(true);
    expect(() => alignTickDown(1, 0)).to.throw('positive');
    expect(() => assertTickRange(0, 1, 99 as FEE_TIER)).to.throw('Unsupported fee tier');
    expect(() => assertTickRange(0.5, 60, FEE_TIER.PERCENT_00_30)).to.throw('integers');
    expect(() => assertTickRange(-887273, 60, FEE_TIER.PERCENT_00_30)).to.throw('satisfy');
    expect(() => assertTickRange(0, 61, FEE_TIER.PERCENT_00_30)).to.throw('aligned');
  });
});
