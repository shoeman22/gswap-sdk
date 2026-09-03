import type { HttpRequestor } from '../types/http_requestor.js';
import type { IndexedTransaction } from '../types/v2_results.js';
import { GSwapSDKError, getObjectProperty, getStringProperty } from './gswap_sdk_error.js';

/** A synchronously submitted v2 transaction with optional indexed confirmation. */
export class SubmittedTransaction {
  public readonly method: string;
  public readonly uniqueKey: string;
  public readonly transactionId: string | null;
  public readonly mode = 'sync' as const;
  public readonly result: unknown;
  private readonly backendBaseUrl: string;
  private readonly requestor: HttpRequestor;

  /** Construct a submitted transaction from a successful gateway response. */
  constructor(options: {
    method: string;
    uniqueKey: string;
    transactionId: string | null;
    result: unknown;
    dexBackendBaseUrl: string;
    httpRequestor: HttpRequestor;
    chainCallTimeoutMs?: number;
  }) {
    this.method = options.method;
    this.uniqueKey = options.uniqueKey;
    this.transactionId = options.transactionId;
    this.result = options.result;
    this.backendBaseUrl = options.dexBackendBaseUrl.replace(/\/$/u, '');
    this.requestor = options.httpRequestor;
  }

  /** Confirm a trade through the indexed explore endpoint; liquidity writes resolve to `null`. */
  public async confirm(options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<IndexedTransaction | null> {
    if (this.method !== 'Trade') return null;
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const pollIntervalMs = options?.pollIntervalMs ?? 2_500;
    const startedAt = Date.now();
    const url = `${this.backendBaseUrl}/explore/transaction?uniqueKey=${encodeURIComponent(this.uniqueKey)}`;

    while (Date.now() - startedAt <= timeoutMs) {
      const response = await this.requestor(url, { method: 'GET' });
      const body = await readBody(response);
      if (response.ok) {
        const envelope = asRecord(body);
        const data = envelope?.['data'] ?? body;
        return data as IndexedTransaction;
      }

      const message = bodyMessage(body);
      const serializedBody = JSON.stringify(body).toLowerCase();
      if (response.status !== 404 || !serializedBody.includes('uniquekey')) {
        throw new GSwapSDKError(message, 'CONFIRMATION_FAILED', {
          status: response.status,
          body,
          url,
        });
      }
      if (Date.now() - startedAt + pollIntervalMs > timeoutMs) break;
      await delay(pollIntervalMs);
    }

    throw GSwapSDKError.confirmationTimeoutError(this.uniqueKey);
  }
}

async function readBody(response: {
  json(): Promise<unknown>;
  text(): Promise<string>;
}): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

function bodyMessage(body: unknown): string {
  return (
    getStringProperty(body, 'message') ??
    getStringProperty(body, 'Message') ??
    getStringProperty(getObjectProperty(body, 'error'), 'message') ??
    getStringProperty(getObjectProperty(body, 'error'), 'Message') ??
    (typeof body === 'string' ? body : 'Transaction confirmation failed')
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
