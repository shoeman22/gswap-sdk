#!/usr/bin/env node
import 'dotenv/config';
import { serializeError } from 'serialize-error';
import { addLiquidityByPrice, addLiquidityByTicks } from './add_liquidity.js';
import { collectFees } from './collect_fees.js';
import { createPool } from './create_pool.js';
import { estimateAddLiquidity } from './estimate_add_liquidity.js';
import { estimateRemoveLiquidity } from './estimate_remove_liquidity.js';
import { getPosition } from './get_position.js';
import { getPool } from './get_pool.js';
import { getUserAssets } from './get_user_assets.js';
import { getUserPositions } from './get_user_positions.js';
import { printResult } from './client.js';
import { quoteExactInput } from './quote_exact_input.js';
import { quoteExactOutput } from './quote_exact_output.js';
import { removeLiquidity } from './remove_all_liquidity.js';
import { swapTokens } from './swap.js';

function usage(): never {
  console.log('Usage: npm run cli -- <command> [args...]');
  console.log('');
  console.log('Reads (GSWAP_ENV defaults to stage):');
  console.log('  quoteExactInput <tokenIn> <tokenOut> <amountIn> [fee]');
  console.log('  quoteExactOutput <tokenIn> <tokenOut> <amountOut> [fee]');
  console.log('  getPool <token0> <token1> <fee>');
  console.log('  getPosition <t0> <t1> <fee> <owner> <tickLower> <tickUpper>');
  console.log('  getUserPositions <owner>');
  console.log('  getUserAssets <owner> [page] [limit]');
  console.log(
    '  estimateAddLiquidity <token0> <token1> <fee> <tickLower> <tickUpper> <token0|token1> <amount>',
  );
  console.log(
    '  estimateRemoveLiquidity <token0> <token1> <fee> <tickLower> <tickUpper> <liquidity>',
  );
  console.log('Writes (set GALACHAIN_PRIVATE_KEY and GALACHAIN_ADDRESS):');
  console.log('  swap <tokenIn> <tokenOut> <fee> <exactIn|exactOut> <amount> [slippage]');
  console.log(
    '  addLiquidityByTicks <token0> <token1> <fee> <tickLower> <tickUpper> <token0|token1> <amount>',
  );
  console.log(
    '  addLiquidityByPrice <token0> <token1> <fee> <minPrice> <maxPrice> <token0|token1> <amount>',
  );
  console.log('  removeLiquidity <token0> <token1> <fee> <tickLower> <tickUpper>');
  console.log('  collectPositionFees <token0> <token1> <fee> <tickLower> <tickUpper>');
  console.log('  createPool <token0ClassKey> <token1ClassKey> <fee> <startingPrice>');
  console.log('');
  console.log('Token input accepts GALA or GALA|Unit|none|none.');
  throw new Error('A command is required.');
}

function required(args: string[], count: number, command: string): void {
  if (args.length < count) throw new Error(`${command} requires at least ${count} arguments.`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();

  switch (command) {
    case 'quoteExactInput':
      required(args, 3, command);
      printResult(await quoteExactInput(args[0]!, args[1]!, args[2]!, args[3]));
      return;
    case 'quoteExactOutput':
      required(args, 3, command);
      printResult(await quoteExactOutput(args[0]!, args[1]!, args[2]!, args[3]));
      return;
    case 'getPool':
      required(args, 3, command);
      printResult(await getPool(args[0]!, args[1]!, args[2]!));
      return;
    case 'getPosition':
      required(args, 6, command);
      printResult(await getPosition(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!));
      return;
    case 'getUserPositions':
      required(args, 1, command);
      printResult(await getUserPositions(args[0]!));
      return;
    case 'getUserAssets':
      required(args, 1, command);
      printResult(
        await getUserAssets(
          args[0]!,
          args[1] ? Number(args[1]) : 1,
          args[2] ? Number(args[2]) : 10,
        ),
      );
      return;
    case 'estimateAddLiquidity':
      required(args, 7, command);
      if (args[5] !== 'token0' && args[5] !== 'token1')
        throw new Error('Deposit side must be token0 or token1.');
      printResult(
        await estimateAddLiquidity(
          args[0]!,
          args[1]!,
          args[2]!,
          args[3]!,
          args[4]!,
          args[5],
          args[6]!,
        ),
      );
      return;
    case 'estimateRemoveLiquidity':
      required(args, 6, command);
      printResult(
        await estimateRemoveLiquidity(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!),
      );
      return;
    case 'swap':
      required(args, 5, command);
      if (args[3] !== 'exactIn' && args[3] !== 'exactOut') {
        throw new Error('swap type must be exactIn or exactOut.');
      }
      printResult(await swapTokens(args[0]!, args[1]!, args[2]!, args[3], args[4]!, args[5]));
      return;
    case 'addLiquidityByTicks':
      required(args, 7, command);
      if (args[5] !== 'token0' && args[5] !== 'token1')
        throw new Error('Deposit side must be token0 or token1.');
      printResult(
        await addLiquidityByTicks(
          args[0]!,
          args[1]!,
          args[2]!,
          args[3]!,
          args[4]!,
          args[5],
          args[6]!,
        ),
      );
      return;
    case 'addLiquidityByPrice':
      required(args, 7, command);
      if (args[5] !== 'token0' && args[5] !== 'token1')
        throw new Error('Deposit side must be token0 or token1.');
      printResult(
        await addLiquidityByPrice(
          args[0]!,
          args[1]!,
          args[2]!,
          args[3]!,
          args[4]!,
          args[5],
          args[6]!,
        ),
      );
      return;
    case 'removeLiquidity':
      required(args, 5, command);
      printResult(await removeLiquidity(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!));
      return;
    case 'collectPositionFees':
      required(args, 5, command);
      printResult(await collectFees(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!));
      return;
    case 'createPool':
      required(args, 4, command);
      printResult(await createPool(args[0]!, args[1]!, args[2]!, args[3]!));
      return;
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(serializeError(error));
  process.exitCode = 1;
});
