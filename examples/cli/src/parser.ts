/** Validate CLI arity and return the command tokens consumed by the dispatcher. */
export function parseCliArgs(argv: string[]): { command: string; args: string[] } {
  const [command, ...args] = argv;
  if (command === undefined) throw new Error('A command is required.');
  const shapes: Record<string, { min: number; max: number }> = {
    quoteExactInput: { min: 3, max: 4 },
    quoteExactOutput: { min: 3, max: 4 },
    getPool: { min: 3, max: 3 },
    getPosition: { min: 6, max: 6 },
    getUserPositions: { min: 1, max: 1 },
    getUserAssets: { min: 1, max: 3 },
    estimateAddLiquidity: { min: 7, max: 7 },
    estimateRemoveLiquidity: { min: 6, max: 6 },
    swap: { min: 5, max: 6 },
    addLiquidityByTicks: { min: 7, max: 7 },
    addLiquidityByPrice: { min: 7, max: 7 },
    removeLiquidity: { min: 5, max: 5 },
    collectPositionFees: { min: 5, max: 5 },
    createPool: { min: 4, max: 4 },
  };
  const shape = shapes[command];
  if (shape === undefined) throw new Error(`Unknown command: ${command}`);
  if (args.length < shape.min || args.length > shape.max) {
    throw new Error(
      `${command} expects ${shape.min === shape.max ? shape.min : `${shape.min}-${shape.max}`} arguments.`,
    );
  }
  return { command, args };
}
