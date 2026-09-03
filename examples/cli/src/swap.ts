import { createWriteClient, parseFee } from './client.js';

/** Submits and confirms an exact-input or exact-output v2 trade. */
export async function swapTokens(
  tokenIn: string,
  tokenOut: string,
  feeText: string,
  swapType: 'exactIn' | 'exactOut',
  amount: string,
  slippageProtection?: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  if (fee === undefined) throw new Error('swap requires a fee tier.');
  const client = createWriteClient();
  const params =
    swapType === 'exactIn'
      ? { exactIn: amount, ...(slippageProtection ? { amountOutMinimum: slippageProtection } : {}) }
      : {
          exactOut: amount,
          ...(slippageProtection ? { amountInMaximum: slippageProtection } : {}),
        };
  const transaction = await client.swaps.swap(tokenIn, tokenOut, fee, params);
  return transaction.confirm();
}
