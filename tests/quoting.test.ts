import { expect } from 'chai';
import BigNumber from 'bignumber.js';
import type { ChainGateway } from '../src/classes/gateway.js';
import { HttpClient } from '../src/classes/http_client.js';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import { Quoting } from '../src/classes/quoting.js';
import { Symbols } from '../src/classes/symbols.js';
import type { ResolvedEnv } from '../src/types/env.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import type { TokenRef } from '../src/types/v2_dtos.js';

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
  const symbols = {
    resolve: async (token: TokenRef): Promise<string> =>
      typeof token === 'string' && token.includes('|') ? (token.split('|')[0] ?? token) : token,
  } as unknown as Symbols;
  const urls = { dexBackendBaseUrl: BASE } as ResolvedEnv;
  return {
    quoting: new Quoting({} as ChainGateway, symbols, new HttpClient(requestor), urls),
    calls,
  };
}

const quoteBody = {
  status: 200,
  message: 'Quote retrieved successfully',
  error: false,
  data: {
    contractVersion: 'v2',
    fee: 3000,
    amountIn: '100',
    amountOut: '14.66774',
    currentSqrtPrice: '0.383660743239253881267134064067944046127611966158491207207439',
    newSqrtPrice: '0.383460560518272386840726362488655890753944357316864840199462',
    newTick: -19172,
    tradingFees: '0.27',
    protocolFees: '0.03',
    totalFees: '0.3',
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
      amountIn: '100',
      amountOut: '14.66774',
      token0Symbol: 'GALA',
      token1Symbol: 'GUSDC',
      tokenInIsToken0: true,
      tradingFees: '0.27',
      protocolFees: '0.03',
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
});
