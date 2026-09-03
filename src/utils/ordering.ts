import type { GalaChainTokenClassKey } from '../types/token.js';

/** A symbol or a GalaChain token class key accepted by v2 operations. */
export type TokenRef = string | GalaChainTokenClassKey;

/** Return two trading symbols in the contract's plain-string order. */
export function orderSymbols(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Read an ordered symbol pair from a tuple or object returned by a boundary helper.
 *
 * @example
 * ```ts
 * const pair = readOrderedSymbols(['GALA', 'GUSDC']);
 * console.log(pair.token0);
 * ```
 */
export function readOrderedSymbols(value: unknown): { token0: string; token1: string } {
  if (Array.isArray(value) && value.length >= 2) {
    const token0 = (value as unknown[])[0];
    const token1 = (value as unknown[])[1];
    if (typeof token0 === 'string' && typeof token1 === 'string') return { token0, token1 };
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const token0 = record['token0'];
    const token1 = record['token1'];
    if (typeof token0 === 'string' && typeof token1 === 'string') return { token0, token1 };
  }
  throw new Error('Unable to order trading symbols.');
}

/** Return the `$`-joined composite key used by GalaChain object identities. */
export function compositeKeyOf(token: GalaChainTokenClassKey): string {
  return [token.collection, token.category, token.type, token.additionalKey].join('$');
}

/** Parse a pipe- or dollar-separated token class key. */
export function parseTokenClassKey(tokenClassKey: TokenRef): GalaChainTokenClassKey {
  if (typeof tokenClassKey === 'object') {
    return {
      collection: tokenClassKey.collection,
      category: tokenClassKey.category,
      type: tokenClassKey.type,
      additionalKey: tokenClassKey.additionalKey,
    };
  }

  const parts = tokenClassKey.includes('|') ? tokenClassKey.split('|') : tokenClassKey.split('$');
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
    throw new Error('Invalid token class key: expected four non-empty parts');
  }

  const [collection, category, type, additionalKey] = parts;
  return {
    collection: collection as string,
    category: category as string,
    type: type as string,
    additionalKey: additionalKey as string,
  };
}
