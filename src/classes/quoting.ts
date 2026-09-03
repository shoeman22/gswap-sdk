import { HttpClient } from './http_client.js';
import { Symbols } from './symbols.js';

/** Service stub reserved for the v2 quoting lane. */
export class Quoting {
  /** Create the quoting service with backend transport and symbol resolution. */
  constructor(
    private readonly dexBackendBaseUrl: string,
    private readonly httpClient: HttpClient,
    private readonly symbols: Symbols,
  ) {
    void this.dexBackendBaseUrl;
    void this.httpClient;
    void this.symbols;
  }
}
