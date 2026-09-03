import { createWriteClient, parseFee } from './client.js';

/** Creates a v2 pool and claims class-key-derived symbols when they are unregistered. */
export async function createPool(
  token0: string,
  token1: string,
  feeText: string,
  startingPrice: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('createPool requires a fee tier.');
  const tx = await createWriteClient().positions.createPool({
    token0,
    token1,
    fee,
    startingPrice,
  });
  return {
    transactionId: tx.transactionId,
    blockNumber: tx.blockNumber,
    uniqueKey: tx.uniqueKey,
    result: tx.result,
  };
}
