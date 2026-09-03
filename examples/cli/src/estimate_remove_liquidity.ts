import { createReadClient, parseFee } from './client.js';

/** Estimates token amounts returned when burning v2 liquidity. */
export async function estimateRemoveLiquidity(
  token0: string,
  token1: string,
  feeText: string,
  tickLowerText: string,
  tickUpperText: string,
  liquidity: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('estimateRemoveLiquidity requires a fee tier.');
  return createReadClient().positions.estimateRemoveLiquidity({
    token0,
    token1,
    fee,
    tickLower: Number(tickLowerText),
    tickUpper: Number(tickUpperText),
    liquidity,
  });
}
