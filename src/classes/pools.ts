import { ChainGateway } from './gateway.js';
import { Symbols } from './symbols.js';

/** Service stub reserved for the v2 pools lane. */
export class Pools {
  /** Create the pools service with shared chain reads and symbol resolution. */
  constructor(
    private readonly gateway: ChainGateway,
    private readonly symbols: Symbols,
  ) {
    void this.gateway;
    void this.symbols;
  }
}
