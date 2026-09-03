import { createReadClient, parseFee } from './client.js';

/** Gets the best or requested v2 quote for selling an exact input amount. */
export async function quoteExactInput(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  feeText?: string,
): Promise<unknown> {
  const fee = parseFee(feeText);
  const client = createReadClient();
  return fee === undefined
    ? client.quoting.quoteExactInput(tokenIn, tokenOut, amountIn)
    : client.quoting.quoteExactInput(tokenIn, tokenOut, amountIn, fee);
}
