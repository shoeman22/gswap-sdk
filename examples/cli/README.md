# gSwap CLI

This example uses `@gala-chain/gswap-sdk` against stage by default. Set
`GSWAP_ENV=prod` for mainnet endpoints.

## Setup

```bash
npm install
printf '%s\n' 'GALACHAIN_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE' 'GALACHAIN_ADDRESS=0xYOUR_ETHEREUM_ACCOUNT' > .env
```

`GALACHAIN_PRIVATE_KEY` and `GALACHAIN_ADDRESS` are required for write
commands. `GALACHAIN_ADDRESS` is the selected Ethereum account (`0x` plus 40
hex digits) used for gateway attribution and Gala Wallet identity matching.

## Commands

Run every command with:

```bash
npm run cli -- <command> [args...]
```

Reads:

```text
quoteExactInput <tokenIn> <tokenOut> <amountIn> [fee]
quoteExactOutput <tokenIn> <tokenOut> <amountOut> [fee]
getPool <token0> <token1> <fee>
getPosition <token0> <token1> <fee> <owner> <tickLower> <tickUpper>
getUserPositions <owner>
getUserAssets <owner> [page] [limit]
estimateAddLiquidity <token0> <token1> <fee> <tickLower> <tickUpper> <token0|token1> <amount>
estimateRemoveLiquidity <token0> <token1> <fee> <tickLower> <tickUpper> <liquidity>
```

Writes:

```text
swap <tokenIn> <tokenOut> <fee> <exactIn|exactOut> <amount> [slippage]
addLiquidityByTicks <token0> <token1> <fee> <tickLower> <tickUpper> <token0|token1> <amount>
addLiquidityByPrice <token0> <token1> <fee> <minPrice> <maxPrice> <token0|token1> <amount>
removeLiquidity <token0> <token1> <fee> <tickLower> <tickUpper>
collectPositionFees <token0> <token1> <fee> <tickLower> <tickUpper>
createPool <token0ClassKey> <token1ClassKey> <fee> <startingPrice>
```

The supported fee values are `0`, `500`, `3000`, and `10000`. Token arguments
may be registered symbols such as `GALA` or class keys such as
`GALA|Unit|none|none`. Amounts and prices are decimal strings.

Examples:

```bash
npm run cli -- quoteExactInput GALA GUSDC 100 3000
npm run cli -- swap GALA GUSDC 3000 exactIn 1.5 1.4
npm run cli -- getPosition GALA GUSDC 3000 'eth|0x0123456789012345678901234567890123456789'  -19200 12000
```
