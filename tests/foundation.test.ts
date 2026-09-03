import { expect } from 'chai';
import { ChainGateway } from '../src/classes/gateway.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { SubmittedTransaction } from '../src/classes/submitted_transaction.js';
import { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import {
  alignTickDown,
  alignTickUp,
  assertTickRange,
  tickFromPrice,
  tickToSqrtPrice,
} from '../src/utils/ticks.js';

function response(body: unknown, status = 200, headers?: Record<string, string>): HTTPResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? null,
    },
  };
}

describe('v2 foundation', () => {
  it('submits the raw signed DTO and returns a synchronous transaction', async () => {
    const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
    const httpRequestor: HttpRequestor = async (url, options) => {
      calls.push({ url, options });
      return response(
        {
          status: 201,
          error: false,
          data: { transactionId: '', mode: 'sync', result: { ok: true } },
        },
        201,
      );
    };
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway-testnet.galachain.com',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://swap-backend.stage.defi.ovh.gala.com',
      httpRequestor,
      walletAddress: 'client|123',
    });

    const transaction = await gateway.submit('Trade', {
      token0: 'A',
      uniqueKey: 'trade-1',
      sell0Qty: '1',
    });
    expect(transaction.transactionId).to.equal(null);
    expect(transaction.result).to.deep.equal({ ok: true });
    expect(calls[0]?.url).to.equal(
      'https://swap-backend.stage.defi.ovh.gala.com/v1/chain/asset/dex-contract/Trade',
    );
    expect(calls[0]?.options?.body).to.equal(
      JSON.stringify({ token0: 'A', uniqueKey: 'trade-1', sell0Qty: '1' }),
    );
    expect(calls[0]?.options?.headers).to.deep.equal({
      'content-type': 'application/json',
      'X-Wallet-Address': 'client|123',
    });
  });

  it('maps gateway bounces and Retry-After to SDK errors', async () => {
    const httpRequestor: HttpRequestor = async () =>
      response({ status: 429, error: true, code: 'RATE_LIMITED', message: 'slow down' }, 429, {
        'retry-after': '30',
      });
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway-testnet.galachain.com',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor,
    });

    const error = await gateway
      .submit('Trade', { uniqueKey: 'trade-1' })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('RATE_LIMITED');
    expect((error as GSwapSDKError).details?.['retryAfterMs']).to.equal(30_000);
  });

  it('unwraps chain reads and follows nextPageBookmark', async () => {
    const bodies: unknown[] = [];
    const httpRequestor: HttpRequestor = async (_url, options) => {
      const body = options?.body;
      if (typeof body !== 'string') throw new Error('Expected a serialized request body.');
      bodies.push(JSON.parse(body) as unknown);
      const page =
        bodies.length === 1 || bodies.length === 2
          ? { results: [{ symbol: 'A' }], nextPageBookmark: 'next' }
          : { results: [{ symbol: 'B' }] };
      return response({ Status: 1, Data: page });
    };
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway-testnet.galachain.com',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor,
    });

    const firstPage = await gateway.chainRead('FetchPools', {});
    expect(firstPage).to.deep.equal({
      results: [{ symbol: 'A' }],
      nextPageBookmark: 'next',
    });
    const all = await gateway.pageAll<{ symbol: string }>('FetchPools');
    expect(all).to.deep.equal([{ symbol: 'A' }, { symbol: 'B' }]);
    expect(bodies).to.deep.equal([{}, {}, { bookmark: 'next' }]);
  });

  it('maps chain read errors', async () => {
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway-testnet.galachain.com',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () =>
        response({ Status: 0, ErrorKey: 'OBJECT_NOT_FOUND', Message: 'missing' }),
    });
    const error = await gateway.chainRead('FetchPools', {}).catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('OBJECT_NOT_FOUND');
    expect((error as GSwapSDKError).chainMessage).to.equal('missing');
  });

  it('resolves symbols and caches the paged registry', async () => {
    let calls = 0;
    const gateway = new ChainGateway({
      gatewayBaseUrl: 'https://gateway-testnet.galachain.com',
      dexContractBasePath: '/api/asset/dex-contract',
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => {
        calls += 1;
        return response({
          Status: 1,
          Data: {
            results: [
              {
                symbol: 'GALA',
                collection: 'GALA',
                category: 'Unit',
                type: 'none',
                additionalKey: 'none',
                decimals: 8,
              },
              {
                symbol: 'GUSDC',
                collection: 'GUSDC',
                category: 'Unit',
                type: 'none',
                additionalKey: 'none',
                decimals: 6,
              },
            ],
          },
        });
      },
    });
    const symbols = new Symbols(gateway);
    expect((await symbols.resolve('GALA|Unit|none|none')).symbol).to.equal('GALA');
    expect((await symbols.resolve('GUSDC')).decimals).to.equal(6);
    expect(await symbols.orderPair('GUSDC', 'GALA')).to.include({ flipped: true });
    expect(calls).to.equal(1);
  });

  it('uses contract tick math and fee spacing', () => {
    expect(tickFromPrice('0.14749')).to.equal(-19141);
    expect(alignTickDown(-19141, 60)).to.equal(-19200);
    expect(alignTickUp(-19141, 60)).to.equal(-19140);
    expect(tickToSqrtPrice(0).toFixed()).to.equal('1');
    expect(() => assertTickRange(-19200, -19080, 3000)).not.to.throw();
    expect(() => assertTickRange(-19141, -19080, 3000)).to.throw('aligned');
  });

  it('confirms indexed trades and times out while 404 remains pending', async () => {
    let calls = 0;
    const transaction = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'trade-1',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => {
        calls += 1;
        return calls === 1
          ? response(
              {
                status: 404,
                error: true,
                message: 'No indexed transaction for that uniqueKey yet',
              },
              404,
            )
          : response({ status: 200, error: false, data: { transactionId: 'tx-1' } });
      },
    });
    expect(await transaction.confirm({ timeoutMs: 100, pollIntervalMs: 0 })).to.deep.equal({
      transactionId: 'tx-1',
    });
    expect(calls).to.equal(2);

    const pending = new SubmittedTransaction({
      method: 'Trade',
      uniqueKey: 'trade-timeout',
      transactionId: null,
      result: {},
      dexBackendBaseUrl: 'https://backend.example',
      httpRequestor: async () => response({ message: 'uniqueKey is still pending' }, 404),
    });
    const error = await pending
      .confirm({ timeoutMs: 2, pollIntervalMs: 0 })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('CONFIRMATION_TIMEOUT');
  });
});
