import { expect } from 'chai';
import { ChainGateway } from '../src/classes/gateway.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { Pools } from '../src/classes/pools.js';
import type { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import { resolveTestSymbol } from './helpers.js';

const BASE = 'https://swap.example.test';

function response(body: unknown): HTTPResponse {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, json: async () => body, text: async () => text };
}

function symbols(): Pick<Symbols, 'resolve'> {
  return { resolve: resolveTestSymbol };
}

function gateway(requestor: HttpRequestor): ChainGateway {
  return new ChainGateway({
    gatewayBaseUrl: 'https://gateway.example.test',
    dexContractBasePath: '/api/asset/dex-contract',
    dexBackendBaseUrl: BASE,
    httpRequestor: requestor,
  });
}

describe('Pools', () => {
  it('follows FetchPools bookmarks', async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    const requestor: HttpRequestor = async (_url, options) => {
      const body = options?.body;
      if (typeof body !== 'string') throw new Error('Expected a serialized request body.');
      requests.push({ method: 'FetchPools', body: JSON.parse(body) as unknown });
      const data =
        requests.length === 1
          ? { results: [{ token0: 'AAA' }], nextPageBookmark: 'next' }
          : { results: [{ token0: 'BBB' }], nextPageBookmark: '' };
      return response({ Status: 1, Data: data });
    };
    const pools = new Pools(gateway(requestor), symbols());
    const result = await pools.getPools();
    expect(result).to.deep.equal([{ token0: 'AAA' }, { token0: 'BBB' }]);
    expect(requests).to.deep.equal([
      { method: 'FetchPools', body: {} },
      { method: 'FetchPools', body: { bookmark: 'next' } },
    ]);
  });

  it('uses resolved caller order for backend pool and slot0 requests', async () => {
    const calls: string[] = [];
    const requestor: HttpRequestor = async (url: string) => {
      calls.push(url);
      return response({
        data: { token0: 'GALA', token1: 'GUSDC', fee: 3000, flippedFromRequest: true },
      });
    };
    const pools = new Pools(gateway(requestor), symbols());
    await pools.getPool('GUSDC|Unit|none|none', 'GALA|Unit|none|none', 3000);
    await pools.getSlot0('GUSDC', 'GALA', 3000);
    expect(calls).to.deep.equal([
      `${BASE}/v2/trade/pool?token0=GUSDC&token1=GALA&fee=3000`,
      `${BASE}/v2/trade/slot0?token0=GUSDC&token1=GALA&fee=3000`,
    ]);
  });

  it('orders symbols for the composite gateway read', async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    const requestor: HttpRequestor = async (_url, options) => {
      requests.push({
        method: 'FetchCompositePoolData',
        body: JSON.parse(typeof options?.body === 'string' ? options.body : '{}') as unknown,
      });
      return response({ Status: 1, Data: { pool: { token0: 'GALA', token1: 'GUSDC' } } });
    };
    const pools = new Pools(gateway(requestor), symbols());
    await pools.getCompositePool('GUSDC', 'GALA', 3000);
    expect(requests).to.deep.equal([
      { method: 'FetchCompositePoolData', body: { token0: 'GALA', token1: 'GUSDC', fee: 3000 } },
    ]);
  });

  it('maps backend failures and validates fee tiers', async () => {
    const failing = new Pools(
      gateway(async () => {
        throw new Error('offline');
      }),
      symbols(),
    );
    const error = await failing.getPool('GALA', 'GUSDC', 3000).catch((caught: unknown) => caught);
    expect((error as Error).message).to.equal('Pool request failed.');
    const invalidFee = await failing.getPool('GALA', 'GUSDC', 1).catch((caught: unknown) => caught);
    expect((invalidFee as GSwapSDKError).message).to.include('Invalid fee tier');

    const empty = new Pools(
      gateway(async () => response({ Status: 1, Data: {} })),
      symbols(),
    );
    expect(await empty.getPools()).to.deep.equal([]);
    const unresolved = new Pools(
      gateway(async () => response({ data: {} })),
      {
        resolve: async () => ({
          symbol: '',
          collection: '',
          category: 'Unit',
          type: 'none',
          additionalKey: 'none',
          decimals: 18,
        }),
      },
    );
    const unresolvedError = await unresolved
      .getPool('A', 'B', 0)
      .catch((caught: unknown) => caught);
    expect((unresolvedError as GSwapSDKError).code).to.equal('SYMBOL_NOT_FOUND');
    const sdkFailure = new Pools(
      gateway(async () => {
        throw new GSwapSDKError('known failure', 'KNOWN');
      }),
      symbols(),
    );
    const known = await sdkFailure
      .getPool('GALA', 'GUSDC', 3000)
      .catch((caught: unknown) => caught);
    expect((known as GSwapSDKError).code).to.equal('KNOWN');
  });
});
