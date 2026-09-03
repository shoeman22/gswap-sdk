import { expect } from 'chai';
import { ChainGateway } from '../src/classes/gateway.js';
import { Pools } from '../src/classes/pools.js';
import type { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import type { TradingSymbol } from '../src/types/v2_results.js';
import type { TokenRef } from '../src/utils/ordering.js';

const BASE = 'https://swap.example.test';

function response(body: unknown): HTTPResponse {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, json: async () => body, text: async () => text };
}

function symbols(): Pick<Symbols, 'resolve'> {
  return {
    resolve: async (token: TokenRef): Promise<TradingSymbol> => {
      const symbol =
        typeof token === 'string'
          ? token.includes('|')
            ? (token.split('|')[0] ?? token)
            : token
          : token.collection;
      return {
        symbol,
        collection: symbol,
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 18,
      };
    },
  };
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
      requests.push({ method: 'FetchPools', body: JSON.parse(String(options?.body)) as unknown });
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
        body: JSON.parse(String(options?.body)) as unknown,
      });
      return response({ Status: 1, Data: { pool: { token0: 'GALA', token1: 'GUSDC' } } });
    };
    const pools = new Pools(gateway(requestor), symbols());
    await pools.getCompositePool('GUSDC', 'GALA', 3000);
    expect(requests).to.deep.equal([
      { method: 'FetchCompositePoolData', body: { token0: 'GALA', token1: 'GUSDC', fee: 3000 } },
    ]);
  });
});
