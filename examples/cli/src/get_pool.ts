import { createReadClient, parseFee } from './client.js';

/** Reads one v2 pool by its two symbols or class keys and fee tier. */
export async function getPool(token0: string, token1: string, feeText: string): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('getPool requires a fee tier.');
  return createReadClient().pools.getPool(token0, token1, fee);
}
