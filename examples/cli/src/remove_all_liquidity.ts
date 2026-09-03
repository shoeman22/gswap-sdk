import { createWriteClient, parseFee } from './client.js';

/** Closes a v2 position by omitting both withdrawal quantities. */
export async function removeLiquidity(
  token0: string,
  token1: string,
  feeText: string,
  tickLowerText: string,
  tickUpperText: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('removeLiquidity requires a fee tier.');
  const tx = await createWriteClient().positions.removeLiquidity({
    token0,
    token1,
    fee,
    tickLower: Number(tickLowerText),
    tickUpper: Number(tickUpperText),
  });
  return tx.confirm();
}
