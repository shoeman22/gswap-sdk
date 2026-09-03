import { createReadClient, parseFee } from './client.js';

/** Estimates the other deposit side and liquidity for a v2 range. */
export async function estimateAddLiquidity(
  token0: string,
  token1: string,
  feeText: string,
  tickLowerText: string,
  tickUpperText: string,
  depositSide: 'token0' | 'token1',
  amount: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('estimateAddLiquidity requires a fee tier.');
  return createReadClient().positions.estimateAddLiquidity({
    token0,
    token1,
    fee,
    tickLower: Number(tickLowerText),
    tickUpper: Number(tickUpperText),
    amount,
    amountIsToken0: depositSide === 'token0',
  });
}
