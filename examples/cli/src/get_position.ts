import { createReadClient, parseFee } from './client.js';

/** Reads a v2 position by its canonical pool, owner, and tick-range identity. */
export async function getPosition(
  token0: string,
  token1: string,
  feeText: string,
  owner: string,
  tickLowerText: string,
  tickUpperText: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('getPosition requires a fee tier.');
  return createReadClient().positions.getPosition({
    token0,
    token1,
    fee,
    owner,
    tickLower: Number(tickLowerText),
    tickUpper: Number(tickUpperText),
  });
}
