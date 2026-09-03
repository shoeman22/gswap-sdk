import { createReadClient } from './client.js';

/** Reads all v2 liquidity positions for an alias. */
export async function getUserPositions(owner: string): Promise<unknown> {
  return createReadClient().positions.getUserPositions(owner);
}
