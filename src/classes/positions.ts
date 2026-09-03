import { ChainGateway } from './gateway.js';
import type { GalaChainSigner } from './signers.js';
import { Symbols } from './symbols.js';

/** Service stub reserved for the v2 positions lane. */
export class Positions {
  /** Create the positions service with shared gateway, registry, signer, and wallet context. */
  constructor(
    private readonly gateway: ChainGateway,
    private readonly symbols: Symbols,
    private readonly signer?: GalaChainSigner,
    private readonly walletAddress?: string,
  ) {
    void this.gateway;
    void this.symbols;
    void this.signer;
    void this.walletAddress;
  }
}
