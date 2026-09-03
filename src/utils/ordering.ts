import type { GalaChainTokenClassKey } from '../types/token.js';

/** A symbol or a GalaChain token class key accepted by v2 operations. */
export type TokenRef = string | GalaChainTokenClassKey;

/** Return two trading symbols in the contract's plain-string order. */
export function orderSymbols(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
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
    collection: collection!,
    category: category!,
    type: type!,
    additionalKey: additionalKey!,
  };
}
