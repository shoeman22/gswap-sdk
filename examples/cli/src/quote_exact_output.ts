import { createReadClient, parseFee } from './client.js';

/** Gets the best or requested v2 quote for buying an exact output amount. */
export async function quoteExactOutput(
  tokenIn: string,
  tokenOut: string,
  amountOut: string,
  feeText?: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  const client = createReadClient();
  return fee === undefined
    ? client.quoting.quoteExactOutput(tokenIn, tokenOut, amountOut)
    : client.quoting.quoteExactOutput(tokenIn, tokenOut, amountOut, fee);
}
