import { createWriteClient, parseFee } from './client.js';
import type { PriceIn } from '@gala-chain/gswap-sdk';

/** Adds one deposit side to an existing or new v2 tick-range position. */
export async function addLiquidityByTicks(
  token0: string,
  token1: string,
  feeText: string,
  tickLowerText: string,
  tickUpperText: string,
  depositSide: 'token0' | 'token1',
  amount: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('addLiquidity requires a fee tier.');
  const client = createWriteClient();
  const deposit = { amount, amountIsToken0: depositSide === 'token0' };
  const tx = await client.positions.addLiquidityByTicks({
    token0,
    token1,
    fee,
    tickLower: Number(tickLowerText),
    tickUpper: Number(tickUpperText),
    ...deposit,
  });
  return tx.confirm();
}

/** Adds liquidity using token1-per-token0 prices; the SDK aligns ticks. */
export async function addLiquidityByPrice(
  token0: string,
  token1: string,
  feeText: string,
  minPrice: string,
  maxPrice: string,
  depositSide: 'token0' | 'token1',
  amount: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('addLiquidity requires a fee tier.');
  const deposit = { amount, amountIsToken0: depositSide === 'token0' };
  const tx = await createWriteClient().positions.addLiquidityByPrice({
    token0,
    token1,
    fee,
    minPrice: minPrice as PriceIn,
    maxPrice: maxPrice as PriceIn,
    ...deposit,
  });
  return tx.confirm();
}
