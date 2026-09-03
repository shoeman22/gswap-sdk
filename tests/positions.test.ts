import { expect } from 'chai';
import { GSwapSDKError } from '../src/classes/gswap_sdk_error.js';
import type { ChainGateway } from '../src/classes/gateway.js';
import { Positions } from '../src/classes/positions.js';
import { SubmittedTransaction } from '../src/classes/submitted_transaction.js';
import type { GalaChainSigner } from '../src/classes/signers.js';
import type { Symbols } from '../src/classes/symbols.js';
import type { PriceIn } from '../src/types/amounts.js';
import type { HTTPResponse, HttpRequestor } from '../src/types/http_requestor.js';
import type { TradingSymbol } from '../src/types/v2_results.js';
import { type TokenRef, compositeKeyOf, parseTokenClassKey } from '../src/utils/ordering.js';

interface RequestRecord {
  url: string;
  options: RequestInit | undefined;
}

interface ResolvedToken extends TradingSymbol {
  symbol: string;
  decimals: number;
  classKey: ReturnType<typeof parseTokenClassKey>;
}

const dexBackendBaseUrl = 'https://backend.test';

const galaKey = parseTokenClassKey('GALA|Unit|none|none');
const gusdcKey = parseTokenClassKey('GUSDC|Unit|none|none');

function response(payload: unknown, status = 200): HTTPResponse {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => body,
  };
}

function createFixture() {
  const requests: RequestRecord[] = [];
  let nextResponse: HTTPResponse = response({ status: 200, error: false, data: [] });
  let submittedMethod = '';
  let submittedBody: Record<string, unknown> | undefined;

  const requestor: HttpRequestor = async (url, options) => {
    requests.push({ url, options });
    return nextResponse;
  };
  const resolve = async (ref: TokenRef): Promise<ResolvedToken> => {
    const value = typeof ref === 'string' ? ref : compositeKeyOf(ref);
    if (value === 'GALA' || value === compositeKeyOf(galaKey)) {
      return {
        symbol: 'GALA',
        collection: 'GALA',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 18,
        classKey: galaKey,
      };
    }
    if (value === 'GUSDC' || value === compositeKeyOf(gusdcKey)) {
      return {
        symbol: 'GUSDC',
        collection: 'GUSDC',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 6,
        classKey: gusdcKey,
      };
    }
    if (value === 'GALA|Unit|none|none') {
      return {
        symbol: 'ZED',
        collection: 'GALA',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none',
        decimals: 18,
        classKey: galaKey,
      };
    }
    throw GSwapSDKError.unknownTokenError(ref);
  };
  const symbols: Pick<Symbols, 'resolve' | 'orderPair'> = {
    resolve,
    orderPair: async (a: TokenRef, b: TokenRef) => {
      const [tokenA, tokenB] = await Promise.all([resolve(a), resolve(b)]);
      return tokenA.symbol < tokenB.symbol
        ? { token0: tokenA, token1: tokenB, flipped: false }
        : { token0: tokenB, token1: tokenA, flipped: true };
    },
  };

  const signer: GalaChainSigner = {
    signObject: async <TObject extends Record<string, unknown>>(
      _method: string,
      object: TObject,
    ): Promise<TObject & { signature: string }> => ({ ...object, signature: 'signed' }),
  };
  const gateway: Pick<ChainGateway, 'submit' | 'httpRequestor' | 'dexBackendBaseUrl'> = {
    httpRequestor: requestor,
    dexBackendBaseUrl,
    submit: async (method: string, body: Record<string, unknown>) => {
      submittedMethod = method;
      submittedBody = body;
      return new SubmittedTransaction({
        method,
        uniqueKey: String(body['uniqueKey']),
        transactionId: null,
        result: {},
        dexBackendBaseUrl,
        httpRequestor: requestor,
      });
    },
  };

  const positions = new Positions(gateway, symbols, signer, 'client|012345678901234567890123');

  return {
    positions,
    gateway,
    symbols,
    signer,
    requests,
    setResponse: (payload: unknown, status = 200) => {
      nextResponse = response(payload, status);
    },
    get submitted() {
      return { method: submittedMethod, body: submittedBody };
    },
  };
}

function withoutSignature(body: Record<string, unknown>): Record<string, unknown> {
  const dto = { ...body };
  delete dto['signature'];
  return dto;
}

describe('Positions v2', () => {
  it('maps user positions from the backend response', async () => {
    const fixture = createFixture();
    fixture.setResponse({
      status: 200,
      error: false,
      data: [
        {
          pool: 'GALA$GUSDC$3000',
          token0Symbol: 'GALA',
          token1Symbol: 'GUSDC',
          fee: 3000,
          owner: 'client|012345678901234567890123',
          tickLower: -19200,
          tickUpper: 12000,
          liquidity: '1000',
          amount0: '10',
          amount1: '20',
          inRange: true,
          currentTick: 1,
          sqrtPrice: '1.2',
        },
      ],
    });

    const result = await fixture.positions.getUserPositions('client|012345678901234567890123');
    expect(result).to.deep.equal([
      {
        pool: 'GALA$GUSDC$3000',
        token0Symbol: 'GALA',
        token1Symbol: 'GUSDC',
        fee: 3000,
        owner: 'client|012345678901234567890123',
        tickLower: -19200,
        tickUpper: 12000,
        liquidity: '1000',
        amount0: '10',
        amount1: '20',
        inRange: true,
        currentTick: 1,
        sqrtPrice: '1.2',
      },
    ]);
    expect(fixture.requests[0]?.url).to.equal(
      'https://backend.test/v2/trade/positions?user=client%7C012345678901234567890123',
    );
  });

  it('normalizes reversed position pairs and flips ticks before the request', async () => {
    const fixture = createFixture();
    fixture.setResponse({
      status: 200,
      error: false,
      data: {
        pool: 'GALA$GUSDC$3000',
        token0Symbol: 'GALA',
        token1Symbol: 'GUSDC',
        fee: 3000,
        owner: 'client|012345678901234567890123',
        tickLower: -19200,
        tickUpper: 12000,
        liquidity: '1',
        amount0: '1',
        amount1: '2',
        inRange: false,
        fees0: '0.4',
        fees1: '0.5',
      },
    });
    const result = await fixture.positions.getPosition({
      token0: 'GUSDC',
      token1: 'GALA',
      fee: 3000,
      owner: 'client|012345678901234567890123',
      tickLower: -12000,
      tickUpper: 19200,
    });

    expect(result).to.deep.include({ fees0: '0.4', fees1: '0.5' });
    expect(fixture.requests[0]?.url).to.equal(
      'https://backend.test/v2/trade/position?token0=GALA&token1=GUSDC&fee=3000&owner=client%7C012345678901234567890123&tickLower=-19200&tickUpper=12000',
    );
  });

  it('returns null for a position 404', async () => {
    const fixture = createFixture();
    fixture.setResponse({ status: 404, error: true, message: 'Position not found' }, 404);
    const result = await fixture.positions.getPosition({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      owner: 'client|012345678901234567890123',
      tickLower: -19200,
      tickUpper: 12000,
    });
    expect(result).to.equal(null);
  });

  it('uses exact estimate URLs and decimal strings', async () => {
    const fixture = createFixture();
    fixture.setResponse({
      status: 200,
      error: false,
      data: {
        amount0: '10',
        amount1: '20',
        liquidity: '30',
        token0Symbol: 'GALA',
        token1Symbol: 'GUSDC',
        tickLower: -19200,
        tickUpper: 12000,
        amountIsCanonicalToken0: true,
      },
    });
    await fixture.positions.estimateAddLiquidity({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
      amount: '1.2300',
      amountIsToken0: true,
    });
    expect(fixture.requests[0]?.url).to.equal(
      'https://backend.test/v2/trade/add-liq-estimate?token0=GALA&token1=GUSDC&fee=3000&tickLower=-19200&tickUpper=12000&amount=1.23&amountIsToken0=true',
    );

    fixture.setResponse({ status: 200, error: false, data: { amount0: '10', amount1: '20' } });
    await fixture.positions.estimateRemoveLiquidity({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
      liquidity: '30.00',
    });
    expect(fixture.requests[1]?.url).to.equal(
      'https://backend.test/v2/trade/remove-liq-estimate?token0=GALA&token1=GUSDC&fee=3000&tickLower=-19200&tickUpper=12000&liquidity=30',
    );
  });

  it('builds AddLiquidity with exactly one deposit field and signs it', async () => {
    const fixture = createFixture();
    await fixture.positions.addLiquidityByTicks({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
      amount: '100.00',
      amountIsToken0: true,
    });
    const submitted = fixture.submitted;
    expect(submitted.method).to.equal('AddLiquidity');
    const dto = withoutSignature(submitted.body ?? {});
    expect(dto).to.deep.include({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
      depositQuantityToken0: '100',
    });
    expect(Object.keys(dto).filter((key) => key.startsWith('depositQuantity'))).to.deep.equal([
      'depositQuantityToken0',
    ]);
    expect(submitted.body?.['signature']).to.equal('signed');
  });

  it('orders AddLiquidity and maps the deposit side for a reversed pair', async () => {
    const fixture = createFixture();
    await fixture.positions.addLiquidityByTicks({
      token0: 'GUSDC',
      token1: 'GALA',
      fee: 3000,
      tickLower: -12000,
      tickUpper: 19200,
      amount: '5',
      amountIsToken0: true,
    });
    const dto = withoutSignature(fixture.submitted.body ?? {});
    expect(dto).to.deep.include({
      token0: 'GALA',
      token1: 'GUSDC',
      tickLower: -19200,
      tickUpper: 12000,
      depositQuantityToken1: '5',
    });
    expect(dto).not.to.have.property('depositQuantityToken0');
  });

  it('aligns negative price-derived ticks down and up', async () => {
    const fixture = createFixture();
    await fixture.positions.addLiquidityByPrice({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      minPrice: '0.14749' as PriceIn,
      maxPrice: '0.2' as PriceIn,
      amount: '10',
      amountIsToken0: false,
    });
    expect(withoutSignature(fixture.submitted.body ?? {})).to.deep.include({
      tickLower: -19200,
      tickUpper: -16080,
      depositQuantityToken1: '10',
    });
  });

  it('omits both withdrawal fields when closing and maps one field when partial', async () => {
    const fixture = createFixture();
    await fixture.positions.removeLiquidity({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
    });
    const closeDto = withoutSignature(fixture.submitted.body ?? {});
    expect(closeDto).not.to.have.property('withdrawalQuantityToken0');
    expect(closeDto).not.to.have.property('withdrawalQuantityToken1');

    await fixture.positions.removeLiquidity({
      token0: 'GUSDC',
      token1: 'GALA',
      fee: 3000,
      tickLower: -12000,
      tickUpper: 19200,
      amount0: '7.50',
    });
    expect(withoutSignature(fixture.submitted.body ?? {})).to.have.property(
      'withdrawalQuantityToken1',
      '7.5',
    );
  });

  it('builds a fee-sweeping CollectPositionFees DTO', async () => {
    const fixture = createFixture();
    await fixture.positions.collectPositionFees({
      token0: 'GUSDC',
      token1: 'GALA',
      fee: 3000,
      tickLower: -12000,
      tickUpper: 19200,
    });
    const dto = withoutSignature(fixture.submitted.body ?? {});
    expect(dto).to.deep.include({
      token0: 'GALA',
      token1: 'GUSDC',
      tickLower: -19200,
      tickUpper: 12000,
    });
    expect(dto).not.to.have.property('amount0Requested');
    expect(dto).not.to.have.property('amount1Requested');
  });

  it('resolves registered symbols, falls back to class collections, and inverts CreatePool price', async () => {
    const fixture = createFixture();
    await fixture.positions.createPool({
      token0: 'GALA|Unit|none|none',
      token1: 'GUSDC|Unit|none|none',
      fee: 0,
      startingPrice: '2',
      isPrivate: true,
      privateAccess: ['client|012345678901234567890123'],
    });
    const dto = withoutSignature(fixture.submitted.body ?? {});
    expect(dto).to.deep.include({
      token0Symbol: 'GUSDC',
      token1Symbol: 'ZED',
      fee: 0,
      startingPrice: '0.5',
      isPrivate: true,
      privateAccess: ['client|012345678901234567890123'],
    });
    expect(dto).to.have.property('token0Key').that.deep.equals(gusdcKey);
    expect(dto).to.have.property('token1Key').that.deep.equals(galaKey);
    expect(dto).not.to.have.property('startingSqrtPrice');

    await fixture.positions.createPool({
      token0: 'GALA|Unit|none|none',
      token1: 'GUSDC|Unit|none|none',
      fee: 500,
      startingSqrtPrice: '4',
    });
    const sqrtDto = withoutSignature(fixture.submitted.body ?? {});
    expect(sqrtDto).to.have.property('startingSqrtPrice', '0.25');
    expect(sqrtDto).not.to.have.property('startingPrice');
  });

  it('covers invalid price inputs, every fee spacing, and withdrawal sides', async () => {
    const fixture = createFixture();
    const badRange = await fixture.positions
      .addLiquidityByPrice({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        minPrice: '2' as PriceIn,
        maxPrice: '1' as PriceIn,
        amount: '1',
        amountIsToken0: true,
      })
      .catch((error: unknown) => error);
    expect((badRange as GSwapSDKError).message).to.include('less than or equal');
    const badPrice = await fixture.positions
      .addLiquidityByPrice({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        minPrice: '0' as PriceIn,
        maxPrice: '1' as PriceIn,
        amount: '1',
        amountIsToken0: true,
      })
      .catch((error: unknown) => error);
    expect((badPrice as GSwapSDKError).message).to.include('finite and positive');
    const badFee = await fixture.positions
      .addLiquidityByPrice({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 1,
        minPrice: '1' as PriceIn,
        maxPrice: '2' as PriceIn,
        amount: '1',
        amountIsToken0: true,
      })
      .catch((error: unknown) => error);
    expect((badFee as GSwapSDKError).code).to.equal('VALIDATION_ERROR');

    const spacingCases = [
      [0, 0, 200],
      [500, 0, 10],
      [3000, 0, 60],
      [10000, 0, 200],
    ] as const;
    for (const [fee, lower, upper] of spacingCases) {
      await fixture.positions.addLiquidityByTicks({
        token0: 'GALA',
        token1: 'GUSDC',
        fee,
        tickLower: lower,
        tickUpper: upper,
        amount: '1',
        amountIsToken0: true,
      });
    }
    const bothAmounts = await fixture.positions
      .removeLiquidity({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        tickLower: -19200,
        tickUpper: 12000,
        amount0: '1',
        amount1: '1',
      })
      .catch((error: unknown) => error);
    expect((bothAmounts as GSwapSDKError).message).to.include('at most one');
    await fixture.positions.removeLiquidity({
      token0: 'GUSDC',
      token1: 'GALA',
      fee: 3000,
      tickLower: -12000,
      tickUpper: 19200,
      amount1: '2',
    });
    expect(withoutSignature(fixture.submitted.body ?? {})).to.have.property(
      'withdrawalQuantityToken0',
      '2',
    );
  });

  it('handles create-pool one-of and class-key fallback failures', async () => {
    const fixture = createFixture();
    const neither = await fixture.positions
      .createPool({ token0: 'GALA', token1: 'GUSDC', fee: 3000 })
      .catch((error: unknown) => error);
    expect((neither as GSwapSDKError).message).to.include('exactly one');
    const both = await fixture.positions
      .createPool({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        startingPrice: '1',
        startingSqrtPrice: '1',
      })
      .catch((error: unknown) => error);
    expect((both as GSwapSDKError).message).to.include('exactly one');
    const badPrice = await fixture.positions
      .createPool({ token0: 'GALA', token1: 'GUSDC', fee: 3000, startingPrice: '0' })
      .catch((error: unknown) => error);
    expect((badPrice as GSwapSDKError).message).to.include('finite and positive');
    await fixture.positions.createPool({
      token0: 'NEW|Unit|none|none',
      token1: 'GUSDC',
      fee: 3000,
      startingPrice: '1',
    });
    const invalidClass = await fixture.positions
      .createPool({ token0: 'UNKNOWN', token1: 'GUSDC', fee: 3000, startingPrice: '1' })
      .catch((error: unknown) => error);
    expect((invalidClass as GSwapSDKError).code).to.equal('UNKNOWN_TOKEN');
  });

  it('maps optional position fields and supports object class-key input', async () => {
    const fixture = createFixture();
    fixture.setResponse({
      status: 200,
      error: false,
      data: [
        {
          token0Symbol: 'GALA',
          token1Symbol: 'GUSDC',
          fee: 3000,
          tickLower: -60,
          tickUpper: 60,
          liquidity: '1',
          amount0: '2',
          amount1: '3',
          inRange: false,
          owner: 'client|alice',
        },
      ],
    });
    expect(await fixture.positions.getUserPositions('client|alice')).to.deep.equal([
      {
        pool: '',
        token0Symbol: 'GALA',
        token1Symbol: 'GUSDC',
        fee: 3000,
        tickLower: -60,
        tickUpper: 60,
        liquidity: '1',
        amount0: '2',
        amount1: '3',
        inRange: false,
        owner: 'client|alice',
      },
    ]);
    await fixture.positions.createPool({
      token0: galaKey,
      token1: 'GUSDC',
      fee: 3000,
      startingPrice: '1',
    });
    const signed = withoutSignature(fixture.submitted.body ?? {});
    expect(signed).to.include({ token0Symbol: 'GALA', token1Symbol: 'GUSDC' });
  });

  it('submits without a wallet header when only a signer is supplied', async () => {
    const fixture = createFixture();
    const unsignedHeader = new Positions(fixture.gateway, fixture.symbols, fixture.signer);
    await unsignedHeader.collectPositionFees({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
    });
    expect(fixture.submitted.method).to.equal('CollectPositionFees');
  });

  it('rethrows non-SDK create-token errors', async () => {
    const fixture = createFixture();
    const positions = new Positions(fixture.gateway, {
      resolve: async () => {
        throw new Error('resolver failed');
      },
      orderPair: fixture.symbols.orderPair,
    });
    const error = await positions
      .createPool({ token0: 'GALA', token1: 'GUSDC', fee: 3000, startingPrice: '1' })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).to.equal('resolver failed');
  });

  it('covers canonical withdrawal sides, nullable failures, and unsiged writes', async () => {
    const fixture = createFixture();
    await fixture.positions.removeLiquidity({
      token0: 'GUSDC',
      token1: 'GALA',
      fee: 3000,
      tickLower: -12000,
      tickUpper: 19200,
      amount0: '2',
    });
    expect(withoutSignature(fixture.submitted.body ?? {})).to.have.property(
      'withdrawalQuantityToken1',
      '2',
    );
    await fixture.positions.removeLiquidity({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      tickLower: -19200,
      tickUpper: 12000,
      amount1: '3',
    });
    expect(withoutSignature(fixture.submitted.body ?? {})).to.have.property(
      'withdrawalQuantityToken1',
      '3',
    );

    fixture.setResponse({ status: 500, error: true, message: 'backend down' }, 500);
    const failed = await fixture.positions
      .getPosition({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        owner: 'client|012345678901234567890123',
        tickLower: -19200,
        tickUpper: 12000,
      })
      .catch((error: unknown) => error);
    expect((failed as GSwapSDKError).details?.['status']).to.equal(500);

    const unsigned = new Positions(fixture.gateway, fixture.symbols);
    const noSigner = await unsigned
      .collectPositionFees({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        tickLower: -19200,
        tickUpper: 12000,
      })
      .catch((error: unknown) => error);
    expect((noSigner as GSwapSDKError).code).to.equal('NO_SIGNER');
  });
});
