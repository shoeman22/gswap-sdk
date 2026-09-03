import type { TradingSymbol } from '../src/types/v2_results.js';
import type { TokenRef } from '../src/utils/ordering.js';

/** Resolve the compact symbol fixtures shared by read/write service tests. */
export function resolveTestSymbol(token: TokenRef): Promise<TradingSymbol> {
  const symbol =
    typeof token === 'string'
      ? token.includes('|')
        ? (token.split('|')[0] ?? token)
        : token
      : token.collection;
  return Promise.resolve({
    symbol,
    collection: symbol,
    category: 'Unit',
    type: 'none',
    additionalKey: 'none',
    decimals: 18,
  });
}
