import { createReadClient } from './client.js';

/** Reads a paginated list of assets owned by an alias. */
export async function getUserAssets(owner: string, page = 1, limit = 10): Promise<unknown> {
  return createReadClient().assets.getUserAssets(owner, page, limit);
}
