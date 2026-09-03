import { createWriteClient, parseFee } from './client.js';

/** Collects every accrued fee from a v2 position. */
export async function collectFees(
  token0: string,
  token1: string,
  feeText: string,
  tickLowerText: string,
  tickUpperText: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('collectPositionFees requires a fee tier.');
  const tx = await createWriteClient().positions.collectPositionFees({
    token0,
    token1,
    fee,
    tickLower: Number(tickLowerText),
    tickUpper: Number(tickUpperText),
  });
  return tx.confirm();
}
