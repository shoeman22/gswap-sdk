import { expect } from 'chai';
import BigNumber from 'bignumber.js';
import { HttpClient } from '../src/classes/http_client.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { Quoting } from '../src/classes/quoting.js';
import type { Symbols } from '../src/classes/symbols.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import { resolveTestSymbol } from './helpers.js';

const BASE = 'https://swap.example.test';
const TOKEN_IN = 'GALA|Unit|none|none';
const TOKEN_OUT = 'GUSDC|Unit|none|none';

function response(body: unknown, status = 200): HTTPResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  };
}

function service(body: unknown, status = 200): { quoting: Quoting; calls: string[] } {
  const calls: string[] = [];
  const requestor: HttpRequestor = async (url: string) => {
    calls.push(url);
    return response(body, status);
  };
  const symbols: Pick<Symbols, 'resolve'> = {
    resolve: resolveTestSymbol,
  };
  return {
    quoting: new Quoting(BASE, new HttpClient(requestor), symbols),
    calls,
  };
}

// Read-only fixture captured from stage /v2/trade/quote for GALA → GUSDC, amountIn=1.
const quoteBody = {
  status: 200,
  message: 'Quote retrieved successfully',
  error: false,
  data: {
    contractVersion: 'v2',
    fee: 3000,
    amountIn: '1',
    amountOut: '0.146929',
    currentSqrtPrice: '0.38389094981864434168909857911577466442326166446596955946297',
    newSqrtPrice: '0.383888944552596611561847272152223749351626388813453279508063',
    newTick: -19149,
    tradingFees: '0.0027',
    protocolFees: '0.0003',
    totalFees: '0.003',
    feeTokenSymbol: 'GALA',
    token0Symbol: 'GALA',
    token1Symbol: 'GUSDC',
    tokenInIsToken0: true,
  },
};

describe('Quoting', () => {
  it('requests one backend quote with resolved tokens and an exact-input amount', async () => {
    const { quoting, calls } = service(quoteBody);
    const quote = await quoting.quoteExactInput(TOKEN_IN, TOKEN_OUT, '100');
    expect(calls).to.deep.equal([
      `${BASE}/v2/trade/quote?tokenIn=GALA&tokenOut=GUSDC&amountIn=100`,
    ]);
    expect(quote).to.include({
      contractVersion: 'v2',
      fee: 3000,
      feeTier: 3000,
      amountIn: '1',
      amountOut: '0.146929',
      token0Symbol: 'GALA',
      token1Symbol: 'GUSDC',
      tokenInIsToken0: true,
      tradingFees: '0.0027',
      protocolFees: '0.0003',
    });
    expect(quote.priceImpact).to.be.instanceOf(BigNumber);
  });

  it('passes an optional fee and amountOut without client-side tier fan-out', async () => {
    const { quoting, calls } = service(quoteBody);
    await quoting.quoteExactOutput(TOKEN_IN, TOKEN_OUT, '10', 0);
    expect(calls).to.deep.equal([
      `${BASE}/v2/trade/quote?tokenIn=GALA&tokenOut=GUSDC&amountOut=10&fee=0`,
    ]);
  });

  it('maps a missing pool response to NO_POOL_AVAILABLE', async () => {
    const { quoting } = service({ status: 404, error: true, message: 'Pool does not exist' }, 404);
    const error = await quoting
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1', 500)
      .catch((cause: unknown) => cause);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('NO_POOL_AVAILABLE');
  });

  it('maps insufficient-liquidity responses to INSUFFICIENT_LIQUIDITY', async () => {
    const { quoting } = service(
      { status: 400, error: true, message: 'Insufficient liquidity for requested amount' },
      400,
    );
    const error = await quoting
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1000000')
      .catch((cause: unknown) => cause);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('INSUFFICIENT_LIQUIDITY');
  });

  it('maps direct and inverse prices, backend message envelopes, and transport failures', async () => {
    const direct = service({
      ...quoteBody,
      data: { ...quoteBody.data, currentPrice: '1', newPrice: '1.1' },
    });
    const directQuote = await direct.quoting.quoteExactInput(TOKEN_IN, TOKEN_OUT, '1');
    expect(directQuote.currentPrice?.toFixed()).to.equal('1');
    expect(directQuote.newPrice?.toFixed()).to.equal('1.1');

    const priceOnly = service({
      ...quoteBody,
      data: {
        ...quoteBody.data,
        currentSqrtPrice: undefined,
        newSqrtPrice: undefined,
        currentPrice: '1',
        newPrice: '1.1',
      },
    });
    const priceOnlyQuote = await priceOnly.quoting.quoteExactInput(TOKEN_IN, TOKEN_OUT, '1');
    expect(priceOnlyQuote.currentSqrtPrice).to.equal(undefined);
    expect(priceOnlyQuote.newSqrtPrice).to.equal(undefined);

    const inverse = service({
      ...quoteBody,
      data: { ...quoteBody.data, tokenInIsToken0: false, currentSqrtPrice: '2', newSqrtPrice: '1' },
    });
    const inverseQuote = await inverse.quoting.quoteExactInput(TOKEN_IN, TOKEN_OUT, '1');
    expect(inverseQuote.currentPrice?.toFixed()).to.equal('0.25');
    expect(inverseQuote.newPrice?.toFixed()).to.equal('1');

    const failed = service({ message: 'backend failed' }, 500);
    const failedError = await failed.quoting
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((error: unknown) => error);
    expect((failedError as GSwapSDKError).code).to.equal('HTTP_ERROR');
    const invalidFee = await service(quoteBody)
      .quoting.quoteExactInput(TOKEN_IN, TOKEN_OUT, '1', 1 as never)
      .catch((error: unknown) => error);
    expect((invalidFee as GSwapSDKError).code).to.equal('VALIDATION_ERROR');

    const transport = new Quoting(
      BASE,
      new HttpClient(async () => {
        throw new Error('offline');
      }),
      { resolve: resolveTestSymbol },
    );
    const transportError = await transport
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((error: unknown) => error);
    expect((transportError as GSwapSDKError).code).to.equal('HTTP_ERROR');
    const unresolved = new Quoting(BASE, new HttpClient(async () => response(quoteBody)), {
      resolve: async () => ({
        symbol: '',
        collection: 'A',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 18,
      }),
    });
    const unresolvedError = await unresolved
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((error: unknown) => error);
    expect((unresolvedError as GSwapSDKError).code).to.equal('SYMBOL_NOT_FOUND');
  });

  it('handles missing square-root prices and nested backend messages', async () => {
    const missingPrice = service({
      ...quoteBody,
      data: { ...quoteBody.data, currentSqrtPrice: undefined, newSqrtPrice: undefined },
    });
    const error = await missingPrice.quoting
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((caught: unknown) => caught);
    expect(error).to.be.instanceOf(GSwapSDKError);
    expect((error as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');

    for (const malformed of [
      { ...quoteBody.data, contractVersion: 'v1' },
      { ...quoteBody.data, fee: '3000' },
      { ...quoteBody.data, fee: Number.NaN },
      { ...quoteBody.data, amountOut: 1 },
      { ...quoteBody.data, newTick: 1.5 },
      { ...quoteBody.data, tokenInIsToken0: 'true' },
      { ...quoteBody.data, currentSqrtPrice: {} as unknown },
      { ...quoteBody.data, newSqrtPrice: null as unknown },
      { ...quoteBody.data, currentPrice: '' },
      { ...quoteBody.data, currentPrice: 'Infinity' },
    ]) {
      const invalid = service({ ...quoteBody, data: malformed });
      const invalidError = await invalid.quoting
        .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
        .catch((caught: unknown) => caught);
      expect((invalidError as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');
    }

    const nonPositivePrice = service({
      ...quoteBody,
      data: { ...quoteBody.data, currentPrice: '0', newPrice: '-1' },
    });
    const nonPositiveError = await nonPositivePrice.quoting
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((caught: unknown) => caught);
    expect(nonPositiveError).to.be.instanceOf(GSwapSDKError);
    expect((nonPositiveError as GSwapSDKError).code).to.equal('INVALID_CHAIN_RESPONSE');

    const nested = new Quoting(
      BASE,
      new HttpClient(async () => {
        throw new GSwapSDKError('wrapper', 'HTTP_ERROR', { body: { message: 'backend failed' } });
      }),
      { resolve: resolveTestSymbol },
    );
    const nestedError = await nested
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((error: unknown) => error);
    expect((nestedError as GSwapSDKError).code).to.equal('HTTP_ERROR');

    const plainBody = new Quoting(
      BASE,
      new HttpClient(async () => {
        throw new GSwapSDKError('wrapper', 'HTTP_ERROR', { body: 'plain failure' });
      }),
      { resolve: resolveTestSymbol },
    );
    const plainError = await plainBody
      .quoteExactInput(TOKEN_IN, TOKEN_OUT, '1')
      .catch((error: unknown) => error);
    expect((plainError as GSwapSDKError).code).to.equal('HTTP_ERROR');
  });
});
