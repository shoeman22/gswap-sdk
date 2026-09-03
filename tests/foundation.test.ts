import { expect } from 'chai';
import { ChainGateway } from '../src/classes/gateway.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import { Symbols } from '../src/classes/symbols.js';
import { assertTickRange, tickFromPrice } from '../src/utils/ticks.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}): HTTPResponse {
  return new Response(JSON.stringify(body), { status, headers });
}

function gateway(httpRequestor: HttpRequestor): ChainGateway {
  return new ChainGateway({
    dexBackendBaseUrl: 'https://swap-backend.stage.defi.ovh.gala.com',
    httpRequestor,
    walletAddress: 'client|123',
  });
}

describe('v2 foundation', () => {
  it('submits through the backend and combines body and response-header metadata', async () => {
    const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
    const transaction = await gateway(async (url, options) => {
      calls.push({ url, options });
      return response({ data: { mode: 'sync', result: { ok: true } } }, 201, {
        'x-transaction-id': 'tx-header',
        'x-block-number': '42',
      });
    }).submit('Trade', { token0: 'A', uniqueKey: 'trade-1', sell0Qty: '1' });

    expect(transaction.transactionId).to.equal('tx-header');
    expect(transaction.blockNumber).to.equal(42);
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

  it('keeps absent transaction headers and body metadata nullable', async () => {
    const transaction = await gateway(async () =>
      response({ data: { transactionId: '', blockNumber: null, mode: 'sync', result: {} } }, 201),
    ).submit('AddLiquidity', { uniqueKey: 'add-1' });
    expect(transaction.transactionId).to.equal(null);
    expect(transaction.blockNumber).to.equal(null);
  });

  it('maps backend bounces and Retry-After to SDK errors', async () => {
    const error = await gateway(async () =>
      response({ code: 'RATE_LIMITED', message: 'slow down' }, 429, { 'Retry-After': '30' }),
    )
      .submit('Trade', { uniqueKey: 'trade-1' })
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('RATE_LIMITED');
    expect((error as GSwapSDKError).retryAfterMs).to.equal(30_000);
  });

  it('reads symbols from the backend and caches the exact response list', async () => {
    const calls: string[] = [];
    const symbol = {
      symbol: 'GALA',
      collection: 'GALA',
      category: 'Unit',
      type: 'none',
      additionalKey: 'none',
      decimals: 8,
    };
    const symbols = new Symbols(
      gateway(async (url) => {
        calls.push(url);
        return response({ status: 200, error: false, data: [symbol] });
      }),
    );
    expect(await symbols.list()).to.deep.equal([symbol]);
    expect(await symbols.resolve('GALA')).to.deep.equal(symbol);
    expect(calls).to.deep.equal(['https://swap-backend.stage.defi.ovh.gala.com/v2/trade/symbols']);
  });

  it('uses contract tick bounds', () => {
    expect(tickFromPrice('0.14749')).to.equal(-19141);
    expect(() => assertTickRange(-887272, 887200, 3000)).to.throw('aligned');
  });
});
