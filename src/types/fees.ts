/**
 * Fee tiers for pools.
 */
export enum FEE_TIER {
  /** No trading fee. */
  PERCENT_00_00 = 0,
  /** 0.05% fee tier */
  PERCENT_00_05 = 500,
  /** 0.3% fee tier */
  PERCENT_00_30 = 3000,
  /** 1.0% fee tier */
  PERCENT_01_00 = 10000,
}

/** Tick spacing required by the current GalaChainDex contract for each fee tier. */
export const TICK_SPACING_BY_FEE: Readonly<Record<FEE_TIER, number>> = {
  [FEE_TIER.PERCENT_00_00]: 200,
  [FEE_TIER.PERCENT_00_05]: 10,
  [FEE_TIER.PERCENT_00_30]: 60,
  [FEE_TIER.PERCENT_01_00]: 200,
};

/** All fee tiers supported by the current GalaChainDex contract. */
export const ALL_FEE_TIERS: readonly FEE_TIER[] = [
  FEE_TIER.PERCENT_00_00,
  FEE_TIER.PERCENT_00_05,
  FEE_TIER.PERCENT_00_30,
  FEE_TIER.PERCENT_01_00,
];
