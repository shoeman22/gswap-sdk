import { expect } from 'chai';
import { ChainGateway } from '../src/classes/gateway.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { Pools } from '../src/classes/pools.js';
import type { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import { resolveTestSymbol } from './helpers.js';

const BASE = 'https://swap.example.test';

function response(body: unknown, status = 200): HTTPResponse {
  return new Response(JSON.stringify(body), { status });
}

function symbols(): Pick<Symbols, 'resolve'> {
  return { resolve: resolveTestSymbol };
}

function gateway(requestor: HttpRequestor): ChainGateway {
  return new ChainGateway({ dexBackendBaseUrl: BASE, httpRequestor: requestor });
}

describe('Pools', () => {
  it('gets the pool list from the backend without pagination or gateway calls', async () => {
    const calls: string[] = [];
    const requestor: HttpRequestor = async (url) => {
      calls.push(url);
      return response({ status: 200, error: false, data: [{ token0: 'AAA', token1: 'BBB' }] });
    };
    const result = await new Pools(gateway(requestor), symbols()).getPools();
    expect(result).to.deep.equal([{ token0: 'AAA', token1: 'BBB' }]);
    expect(calls).to.deep.equal([`${BASE}/v2/trade/pools`]);
  });

  it('uses caller order for pool and slot0 backend requests', async () => {
    const calls: string[] = [];
    const requestor: HttpRequestor = async (url) => {
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

  it('orders the composite-pool request and maps empty backend lists', async () => {
    const calls: string[] = [];
    const requestor: HttpRequestor = async (url) => {
      calls.push(url);
      return response({ data: { pool: { token0: 'GALA', token1: 'GUSDC' } } });
    };
    const pools = new Pools(gateway(requestor), symbols());
    await pools.getCompositePool('GUSDC', 'GALA', 3000);
    expect(calls).to.deep.equal([
      `${BASE}/v2/trade/composite-pool?token0=GALA&token1=GUSDC&fee=3000`,
    ]);

    const empty = new Pools(
      gateway(async () => response({ data: [] })),
      symbols(),
    );
    expect(await empty.getPools()).to.deep.equal([]);
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
    const invalidFee = await failing
      .getPool('GALA', 'GUSDC', 1 as never)
      .catch((caught: unknown) => caught);
    expect((invalidFee as GSwapSDKError).message).to.include('Invalid fee tier');

    const invalidList = new Pools(
      gateway(async () => response({ data: { not: 'an array' } })),
      symbols(),
    );
    const invalidListError = await invalidList.getPools().catch((caught: unknown) => caught);
    expect((invalidListError as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');

    const timedGateway = new ChainGateway({
      dexBackendBaseUrl: BASE,
      httpRequestor: async () => response({ data: [] }),
      chainCallTimeoutMs: 5,
    });
    await new Pools(timedGateway, symbols()).getPools({ signal: new AbortController().signal });

    const sdkFailure = new GSwapSDKError('backend rejected', 'HTTP_ERROR');
    const preservedFailure = new Pools(
      gateway(async () => {
        throw sdkFailure;
      }),
      symbols(),
    );
    const preserved = await preservedFailure
      .getPool('GALA', 'GUSDC', 3000)
      .catch((caught: unknown) => caught);
    expect(preserved).to.equal(sdkFailure);

    const emptySymbol = new Pools(
      gateway(async () => response({ data: {} })),
      {
        resolve: async () => ({
          symbol: '',
          collection: 'A',
          category: 'Unit',
          type: 'none',
          additionalKey: 'none',
          decimals: 8,
        }),
      },
    );
    const emptySymbolError = await emptySymbol
      .getPool('A', 'B', 3000)
      .catch((caught: unknown) => caught);
    expect((emptySymbolError as GSwapSDKError).code).to.equal('SYMBOL_NOT_FOUND');
  });
});
