import { randomUUID } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import BigNumber from 'bignumber.js';
import { expect } from 'chai';
import { ALL_FEE_TIERS, GSwap, GSwapSDKError, PrivateKeySigner } from '../../src/index.js';
import type { IndexedTransaction, Position, SubmittedTransaction } from '../../src/index.js';

const WALLET_ADDRESS = 'client|618ae395c1c653111d3315be';
const LIVE_LOCK = '/tmp/swap-e2e-live.lock';
const WRITE_PACE_MS = 3_000;
const LOCK_RETRY_MS = 30_000;
const LOCK_TIMEOUT_MS = 90 * 60 * 1_000;
const POSITION_TIMEOUT_MS = 60_000;

interface LedgerRow {
  method: string;
  uniqueKey: string;
  transactionId: string;
  block: string;
}

describe('stage live v2 flow', function () {
  this.timeout(300_000);

  it('quotes, swaps, manages liquidity, and verifies gateway failures', async () => {
    const privateKey = process.env['GSWAP_LIVE_PRIVATE_KEY'];
    if (process.env['GSWAP_ENV'] !== 'stage') {
      throw new Error('GSWAP_ENV must be stage for the live test.');
    }
    if (privateKey === undefined || privateKey.length === 0) {
      throw new Error('GSWAP_LIVE_PRIVATE_KEY must be set for the live test.');
    }

    const signer = new PrivateKeySigner(privateKey);
    const sdk = new GSwap({
      env: 'stage',
      signer,
      walletAddress: WALLET_ADDRESS,
    });
    const quote = await sdk.quoting.quoteExactInput('GALA', 'GUSDC', '1');
    const selectedFee = Number(quote.feeTier);
    expect(ALL_FEE_TIERS.map(Number).includes(selectedFee)).to.equal(true);

    const balanceBefore = await sdk.assets.getUserAssets(WALLET_ADDRESS, 1, 100);
    const gusdcBefore = assetQuantity(balanceBefore.tokens, 'GUSDC');
    const initialSlot0 = await sdk.pools.getSlot0('GALA', 'GUSDC', 3000);
    expect(initialSlot0.token0).to.equal('GALA');
    expect(initialSlot0.token1).to.equal('GUSDC');

    const releaseLock = await acquireLiveLock();
    const ledger: LedgerRow[] = [];
    let ticks: { tickLower: number; tickUpper: number } | undefined;

    try {
      await paceWrite();
      const swap = await sdk.swaps.swap('GALA', 'GUSDC', selectedFee, { exactIn: '1' });
      const confirmation = await swap.confirm({ timeoutMs: 120_000, pollIntervalMs: 3_000 });
      expect(confirmation).not.to.equal(null);
      if (confirmation === null) throw new Error('Trade confirmation unexpectedly returned null.');
      expect(confirmation.blockNumber).to.be.greaterThan(0);
      expect(confirmation.uniqueKey).to.equal(swap.uniqueKey);
      ledger.push(tradeLedgerRow(swap, confirmation));

      await waitForBalanceIncrease(sdk, gusdcBefore);

      const liquiditySlot0 = await sdk.pools.getSlot0('GALA', 'GUSDC', 3000);
      ticks = {
        tickLower: Math.floor((liquiditySlot0.tick - 6_000) / 60) * 60,
        tickUpper: Math.ceil((liquiditySlot0.tick + 6_000) / 60) * 60,
      };
      expect(liquiditySlot0.tick).to.be.greaterThan(ticks.tickLower);
      expect(liquiditySlot0.tick).to.be.lessThan(ticks.tickUpper);

      await paceWrite();
      const addLiquidity = await sdk.positions.addLiquidityByTicks({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        amount: '100',
        amountIsToken0: true,
      });
      ledger.push(submissionLedgerRow(addLiquidity));

      const position = await waitForPosition(sdk, ticks);
      expect(new BigNumber(position.liquidity).isGreaterThan(0)).to.equal(true);

      await paceWrite();
      const collect = await sdk.positions.collectPositionFees({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
      });
      ledger.push(submissionLedgerRow(collect));

      await paceWrite();
      const removeLiquidity = await sdk.positions.removeLiquidity({
        token0: 'GALA',
        token1: 'GUSDC',
        fee: 3000,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
      });
      ledger.push(submissionLedgerRow(removeLiquidity));
      await waitForPositionToClose(sdk, ticks);

      await paceWrite();
      await expectSdkError(
        () =>
          sdk.positions.createPool({
            token0: 'GALA|Unit|none|none',
            token1: 'GUSDC|Unit|none|none',
            fee: 3000,
            startingPrice: '0.15',
          }),
        (error) =>
          (error.code === 'SYMBOL_CONFLICT' || error.code === 'CHAIN_DISPATCH_FAILED') &&
          /already exists/iu.test(error.message),
      );

      // The SDK rejects a negative bound locally, before anything is signed or sent.
      await expectSdkError(
        () =>
          sdk.swaps.swap('GALA', 'GUSDC', selectedFee, {
            exactIn: '1',
            amountOutMinimum: '-1',
          }),
        (error) => error.code === 'VALIDATION_ERROR',
      );

      // The gateway's bounds validator bounces the same DTO when it is submitted raw.
      await paceWrite();
      const negativeBoundDto = await signer.signObject('Trade', {
        token0: 'GALA',
        token1: 'GUSDC',
        fee: selectedFee,
        uniqueKey: `gswap-sdk-live-${randomUUID()}`,
        sell0Qty: '1',
        amountOutMinimum: '-1',
      });
      await expectSdkError(
        () => sdk.gateway.submit('Trade', negativeBoundDto, { walletAddress: WALLET_ADDRESS }),
        (error) => error.code === 'BOUNDS_VIOLATION',
      );

      await paceWrite();
      const throwawaySdk = new GSwap({
        env: 'stage',
        signer: new PrivateKeySigner('1'.repeat(64)),
      });
      await expectSdkError(
        () => throwawaySdk.swaps.swap('GALA', 'GUSDC', selectedFee, { exactIn: '1' }),
        (error) =>
          error.code === 'CHAIN_DISPATCH_FAILED' && /Insufficient balance/iu.test(error.message),
      );
    } finally {
      await releaseLock();
    }

    const pool = await sdk.pools.getPool('GALA', 'GUSDC', 3000);
    const slot0 = await sdk.pools.getSlot0('GALA', 'GUSDC', 3000);
    const composite = await sdk.pools.getCompositePool('GALA', 'GUSDC', 3000);
    expect(pool.token0).to.equal(composite.pool.token0);
    expect(pool.token1).to.equal(composite.pool.token1);
    expect(pool.fee).to.equal(composite.pool.fee);
    expect(slot0.token0).to.equal(composite.currentTradingPrice.token0);
    expect(slot0.token1).to.equal(composite.currentTradingPrice.token1);
    expect(slot0.fee).to.equal(composite.currentTradingPrice.fee);
    expect(slot0.tick).to.be.closeTo(composite.currentTradingPrice.tick, 1);

    console.table(ledger);
  });
});

async function acquireLiveLock(): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let owned = false;
  let interrupted = false;

  const signalHandler = () => {
    interrupted = true;
    void release().finally(() => {
      process.exitCode = 130;
    });
  };

  const release = async (): Promise<void> => {
    if (!owned) return;
    owned = false;
    process.off('SIGINT', signalHandler);
    await rmdir(LIVE_LOCK);
  };

  process.once('SIGINT', signalHandler);

  while (Date.now() < deadline) {
    if (interrupted) throw new Error('Live lock acquisition interrupted.');
    try {
      await mkdir(LIVE_LOCK);
      owned = true;
      return release;
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) {
        process.off('SIGINT', signalHandler);
        throw error;
      }
      await delay(LOCK_RETRY_MS);
    }
  }

  process.off('SIGINT', signalHandler);
  throw new Error('Timed out waiting for the shared live-test lock.');
}

async function paceWrite(): Promise<void> {
  await delay(WRITE_PACE_MS);
}

async function waitForPosition(
  sdk: GSwap,
  ticks: { tickLower: number; tickUpper: number },
): Promise<Position> {
  const deadline = Date.now() + POSITION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const position = await sdk.positions.getPosition({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      owner: WALLET_ADDRESS,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
    });
    if (position !== null && new BigNumber(position.liquidity).isGreaterThan(0)) return position;
    await delay(3_000);
  }
  throw new Error('Timed out waiting for the added position to index.');
}

async function waitForBalanceIncrease(sdk: GSwap, before: BigNumber): Promise<void> {
  const deadline = Date.now() + POSITION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const assets = await sdk.assets.getUserAssets(WALLET_ADDRESS, 1, 100);
    if (assetQuantity(assets.tokens, 'GUSDC').isGreaterThan(before)) return;
    await delay(3_000);
  }
  throw new Error('Timed out waiting for the swapped GUSDC balance to index.');
}

async function waitForPositionToClose(
  sdk: GSwap,
  ticks: { tickLower: number; tickUpper: number },
): Promise<void> {
  const deadline = Date.now() + POSITION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const position = await sdk.positions.getPosition({
      token0: 'GALA',
      token1: 'GUSDC',
      fee: 3000,
      owner: WALLET_ADDRESS,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
    });
    if (position === null) return;
    await delay(3_000);
  }
  throw new Error('Timed out waiting for the removed position to disappear.');
}

async function expectSdkError(
  action: () => Promise<unknown>,
  predicate: (error: GSwapSDKError) => boolean,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).to.be.instanceOf(GSwapSDKError);
  if (!(caught instanceof GSwapSDKError)) throw new Error('Expected GSwapSDKError.');
  expect(predicate(caught)).to.equal(true, caught.message);
}

function assetQuantity(
  tokens: Array<{ symbol: string; quantity: string }>,
  symbol: string,
): BigNumber {
  const asset = tokens.find((token) => token.symbol === symbol);
  if (asset === undefined) throw new Error(`Asset ${symbol} was not returned.`);
  return new BigNumber(asset.quantity);
}

function submissionLedgerRow(transaction: SubmittedTransaction): LedgerRow {
  return {
    method: transaction.method,
    uniqueKey: transaction.uniqueKey,
    transactionId: transaction.transactionId ?? '',
    block: '',
  };
}

function tradeLedgerRow(
  transaction: SubmittedTransaction,
  confirmation: IndexedTransaction,
): LedgerRow {
  return {
    method: transaction.method,
    uniqueKey: transaction.uniqueKey,
    transactionId: transaction.transactionId ?? confirmation.transactionId,
    block: String(confirmation.blockNumber),
  };
}

function isAlreadyExists(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return error.code === 'EEXIST';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
