import { expect } from 'chai';
import type { ChainGateway } from '../src/classes/gateway.js';
import { HttpClient } from '../src/classes/http_client.js';
import { Pools } from '../src/classes/pools.js';
import type { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import type { ResolvedEnv } from '../src/types/env.js';
import type { TokenRef } from '../src/types/v2_dtos.js';

const BASE = 'https://swap.example.test';

function response(body: unknown): HTTPResponse {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, json: async () => body, text: async () => text };
}

function symbols(): Symbols {
  return {
    resolve: async (token: TokenRef): Promise<string> =>
      typeof token === 'string' && token.includes('|') ? (token.split('|')[0] ?? token) : token,
  } as unknown as Symbols;
}

describe('Pools', () => {
  it('follows FetchPools bookmarks', async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    const gateway = {
      evaluate: async <T>(method: string, body: unknown): Promise<T> => {
        requests.push({ method, body });
        return (
          requests.length === 1
            ? { results: [{ token0: 'AAA' }], nextPageBookmark: 'next' }
            : { results: [{ token0: 'BBB' }], nextPageBookmark: '' }
        ) as T;
      },
    } as unknown as ChainGateway;
    const pools = new Pools(gateway, symbols(), new HttpClient(), {
      dexBackendBaseUrl: BASE,
    } as ResolvedEnv);
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
    const pools = new Pools({}, symbols(), new HttpClient(requestor), {
      dexBackendBaseUrl: BASE,
    } as ResolvedEnv);
    await pools.getPool('GUSDC|Unit|none|none', 'GALA|Unit|none|none', 3000);
    await pools.getSlot0('GUSDC', 'GALA', 3000);
    expect(calls).to.deep.equal([
      `${BASE}/v2/trade/pool?token0=GUSDC&token1=GALA&fee=3000`,
      `${BASE}/v2/trade/slot0?token0=GUSDC&token1=GALA&fee=3000`,
    ]);
  });

  it('orders symbols for the composite gateway read', async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    const gateway = {
      evaluate: async <T>(method: string, body: unknown): Promise<T> => {
        requests.push({ method, body });
        return { pool: { token0: 'GALA', token1: 'GUSDC' } } as T;
      },
    } as unknown as ChainGateway;
    const pools = new Pools(gateway, symbols(), new HttpClient(), {
      dexBackendBaseUrl: BASE,
    } as ResolvedEnv);
    await pools.getCompositePool('GUSDC', 'GALA', 3000);
    expect(requests).to.deep.equal([
      { method: 'FetchCompositePoolData', body: { token0: 'GALA', token1: 'GUSDC', fee: 3000 } },
    ]);
  });
});
