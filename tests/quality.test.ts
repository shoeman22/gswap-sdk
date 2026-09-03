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
import type { Position } from '../src/types/v2_results.js';
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
    dexBackendBaseUrl: `${BASE}/backend/`,
    httpRequestor: requestor,
  });
}

describe('quality boundaries', () => {
  it('covers SDK construction, HTTP methods, and asset validation/mapping', async () => {
    const calls: Array<{
      url: string;
      method: string;
      body?: string;
      headers?: RequestInit['headers'];
    }> = [];
    const requestor: HttpRequestor = async (url, options) => {
      calls.push({
        url,
        method: options?.method ?? 'GET',
        ...(typeof options?.body === 'string' ? { body: options.body } : {}),
        ...(options?.headers === undefined ? {} : { headers: options.headers }),
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
    expect(calls[0]?.headers).to.deep.include({ 'User-Agent': 'GalaChain-SDK/1.0.0-rc.1' });
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
      dexBackendBaseUrl: `${BASE}/backend/`,
      httpRequestor: requestor,
      chainCallTimeoutMs: 123,
    });
    expect(client.dexBackendBaseUrl).to.equal(`${BASE}/backend`);
    expect(client.chainCallTimeoutMs).to.equal(123);
    expect(client.assets).to.be.instanceOf(Assets);
    const defaultClient = new GSwap({ walletAddress: 'client|alice' });
    expect(defaultClient.dexBackendBaseUrl).to.equal('https://dex-backend-prod1.defi.gala.com');
    expect(new GSwap().dexBackendBaseUrl).to.equal('https://dex-backend-prod1.defi.gala.com');
  });

  it('maps every gateway bounce code and HTTP response shape', async () => {
    const codes = [
      'METHOD_NOT_ALLOWED',
      'SIGNATURE_INVALID',
      'SIGNER_MISMATCH',
      'DTO_INVALID',
      'BOUNDS_VIOLATION',
      'SYMBOL_CONFLICT',
      'INVALID_STRINGS_INSTRUCTIONS',
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
    const objectWithoutMessage = await gateway(async () => makeResponse({ unexpected: true }, 500))
      .submit('Trade', { uniqueKey: 'object-without-message' })
      .catch((caught: unknown) => caught);
    expect((objectWithoutMessage as GSwapSDKError).message).to.equal(
      'Gateway request failed with HTTP 500',
    );

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
      makeResponse({ data: { transactionId: 'tx-2', mode: 'sync', result: null } }, 201),
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

    const missingData = await gateway(async () => makeResponse({ status: 201 }, 201))
      .submit('Trade', { uniqueKey: 'missing-data' })
      .catch((caught: unknown) => caught);
    expect((missingData as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');

    const uppercaseData = await gateway(async () =>
      makeResponse({ Status: 1, Data: { mode: 'sync', result: null } }, 201),
    ).submit('Trade', { uniqueKey: 'uppercase-data' });
    expect(uppercaseData.transactionId).to.equal(null);

    const bodyBlock = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null, blockNumber: 8 } }, 201),
    ).submit('AddLiquidity', { uniqueKey: 'body-block' });
    expect(bodyBlock.blockNumber).to.equal(8);

    const bodyMetadata = await gateway(async () =>
      makeResponse(
        { data: { mode: 'sync', result: null, transactionId: 'body-tx', blockNumber: 9 } },
        201,
        { headers: { 'x-transaction-id': 'header-tx', 'x-block-number': '10' } },
      ),
    ).submit('AddLiquidity', { uniqueKey: 'body-metadata' });
    expect(bodyMetadata.transactionId).to.equal('body-tx');
    expect(bodyMetadata.blockNumber).to.equal(9);

    const positionConfirmation = async (): Promise<null> => null;
    const hookedSubmission = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null } }, 201),
    ).submit('RemoveLiquidity', { uniqueKey: 'hooked' }, { positionConfirmation });
    expect(hookedSubmission.method).to.equal('RemoveLiquidity');

    const invalidBodyBlock = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null, blockNumber: -1 } }, 201),
    )
      .submit('Trade', { uniqueKey: 'invalid-body-block' })
      .catch((caught: unknown) => caught);
    expect((invalidBodyBlock as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');

    const invalidBodyTransaction = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null, transactionId: 42 } }, 201),
    )
      .submit('Trade', { uniqueKey: 'invalid-body-transaction' })
      .catch((caught: unknown) => caught);
    expect((invalidBodyTransaction as GSwapSDKError).code).to.equal('INVALID_GATEWAY_RESPONSE');

    const recordHeaders = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null, blockNumber: null } }, 201, {
        headers: { 'x-transaction-id': 'record-tx', 'x-block-number': '7' },
      }),
    ).submit('AddLiquidity', { uniqueKey: 'record-headers' });
    expect(recordHeaders.transactionId).to.equal('record-tx');
    expect(recordHeaders.blockNumber).to.equal(7);

    const invalidBlockHeader = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null, blockNumber: null } }, 201, {
        headers: { 'x-block-number': 'not-a-block' },
      }),
    ).submit('AddLiquidity', { uniqueKey: 'invalid-block-header' });
    expect(invalidBlockHeader.blockNumber).to.equal(null);

    const emptyTransactionHeader = await gateway(async () =>
      makeResponse({ data: { mode: 'sync', result: null } }, 201, {
        headers: { 'x-transaction-id': '' },
      }),
    ).submit('Trade', { uniqueKey: 'empty-transaction-header' });
    expect(emptyTransactionHeader.transactionId).to.equal(null);

    const transportFailure = await gateway(async () => {
      throw new Error('transport failed');
    })
      .submit('Trade', { uniqueKey: 'transport-failure' })
      .catch((caught: unknown) => caught);
    expect(transportFailure).to.be.instanceOf(Error);
    expect((transportFailure as Error).message).to.equal('transport failed');
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

    const malformedConfirmation = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'malformed-confirmation',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse('not an object'),
    });
    const malformedConfirmationError = await malformedConfirmation
      .confirm()
      .catch((error: unknown) => error);
    expect((malformedConfirmationError as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');

    const retryAfterConfirmation = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'retry-after-confirmation',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () =>
        makeResponse(
          { error: true, message: 'No indexed transaction for that uniqueKey yet' },
          429,
          { headers: { 'Retry-After': '0' } },
        ),
    });
    const retryAfterError = await retryAfterConfirmation
      .confirm({ timeoutMs: 1, pollIntervalMs: 1 })
      .catch((error: unknown) => error);
    expect((retryAfterError as GSwapSDKError).code).to.equal('CONFIRMATION_TIMEOUT');

    const retryWithoutHeader = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'retry-without-header',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({ error: true }, 429),
    });
    const retryWithoutHeaderError = await retryWithoutHeader
      .confirm({ timeoutMs: 1, pollIntervalMs: 1 })
      .catch((error: unknown) => error);
    expect((retryWithoutHeaderError as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');

    const retryWithInvalidHeader = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'retry-with-invalid-header',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () =>
        makeResponse({ error: true }, 429, { headers: { get: () => 'invalid' } }),
    });
    const retryWithInvalidHeaderError = await retryWithInvalidHeader
      .confirm({ timeoutMs: 1, pollIntervalMs: 1 })
      .catch((error: unknown) => error);
    expect((retryWithInvalidHeaderError as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');

    const positionConfirmation = new SubmittedTransaction({
      method: 'AddLiquidity',
      uniqueKey: 'position-timeout',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({}),
      positionConfirmation: async () => null,
    });
    const positionError = await positionConfirmation
      .confirm({ timeoutMs: 1, pollIntervalMs: 1 })
      .catch((error: unknown) => error);
    expect((positionError as GSwapSDKError).code).to.equal('CONFIRMATION_TIMEOUT');

    let positionCalls = 0;
    const eventualPosition = new SubmittedTransaction({
      method: 'RemoveLiquidity',
      uniqueKey: 'eventual-position',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({}),
      positionConfirmation: async (): Promise<Position | null> => {
        positionCalls += 1;
        return positionCalls === 1 ? null : ({} as Position);
      },
    });
    expect(await eventualPosition.confirm({ timeoutMs: 1_000, pollIntervalMs: 1 })).to.deep.equal(
      {},
    );
    expect(positionCalls).to.equal(2);

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

    const knownButNotPending = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'known-but-not-pending',
      transactionId: 'tx-known',
      blockNumber: 3,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({ error: true, message: 'other failure' }, 404),
    });
    const knownFailure = await knownButNotPending
      .confirm({ timeoutMs: 1, pollIntervalMs: 0 })
      .catch((error: unknown) => error);
    expect((knownFailure as GSwapSDKError).code).to.equal('CONFIRMATION_FAILED');
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
    expect(await textResponse.confirm()).to.deep.equal({
      transactionId: 'tx-text',
      uniqueKey: 'text',
    });
    const wrappedResponse = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'wrapped',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => makeResponse({ data: { transactionId: 'tx-wrapped' } }),
    });
    expect(await wrappedResponse.confirm()).to.deep.equal({
      transactionId: 'tx-wrapped',
      uniqueKey: 'wrapped',
    });

    expect(GSwapSDKError.noSignerError().code).to.equal('NO_SIGNER');
    expect(GSwapSDKError.noPoolAvailableError('A', 'B').code).to.equal('NO_POOL_AVAILABLE');
    expect(GSwapSDKError.insufficientLiquidityError('A', 'B', 0).details?.['fee']).to.equal(0);
    expect(
      GSwapSDKError.fromChainError('CHAIN_ERROR', 'rejected', { source: 'test' }).details,
    ).to.deep.include({ source: 'test', errorKey: 'CHAIN_ERROR' });
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
      httpRequestor: async (): Promise<HTTPResponse> => {
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
        return makeResponse({ data: symbols });
      },
      dexBackendBaseUrl: BASE,
      requestTimeoutMs: 30_000,
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

      let refreshCalls = 0;
      const refreshed = new Symbols({
        httpRequestor: async () => {
          refreshCalls += 1;
          return makeResponse({
            data:
              refreshCalls === 1
                ? []
                : [
                    {
                      symbol: 'GALA',
                      collection: 'GALA',
                      category: 'Unit',
                      type: 'none',
                      additionalKey: 'none',
                      decimals: 18,
                    },
                  ],
          });
        },
        dexBackendBaseUrl: BASE,
      });
      expect(await refreshed.resolve('GALA')).to.have.property('symbol', 'GALA');
      expect(refreshCalls).to.equal(2);
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
    expect(sqrtPriceToTick(tickToSqrtPrice(-887272))).to.equal(-887272);
    expect(sqrtPriceToTick(tickToSqrtPrice(887272))).to.equal(887272);
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
