import type { HttpRequestor } from '../types/http_requestor.js';
import type { IndexedTransaction, Position } from '../types/v2_results.js';
import { GSwapSDKError, getObjectProperty, getStringProperty } from './gswap_sdk_error.js';
import { readResponseBody, requestWithTimeout } from '../utils/transport.js';

/** A synchronously submitted v2 transaction with optional indexed confirmation. */
export class SubmittedTransaction<TConfirmation = IndexedTransaction | Position | null> {
  public readonly method: string;
  public readonly uniqueKey: string;
  public readonly transactionId: string | null;
  public readonly blockNumber: number | null;
  public readonly mode = 'sync' as const;
  public readonly result: unknown;
  private readonly backendBaseUrl: string;
  private readonly requestor: HttpRequestor;
  private readonly requestTimeoutMs: number;
  private readonly positionConfirmation:
    | ((signal: AbortSignal) => Promise<Position | null>)
    | undefined;

  /** Construct a submitted transaction from a successful gateway response. */
  constructor(options: {
    method: string;
    uniqueKey: string;
    transactionId: string | null;
    result: unknown;
    dexBackendBaseUrl: string;
    httpRequestor: HttpRequestor;
    blockNumber?: number | null | undefined;
    requestTimeoutMs?: number | undefined;
    positionConfirmation?: ((signal: AbortSignal) => Promise<Position | null>) | undefined;
  }) {
    this.method = options.method;
    this.uniqueKey = options.uniqueKey;
    this.transactionId = options.transactionId;
    this.blockNumber = options.blockNumber ?? null;
    this.result = options.result;
    this.backendBaseUrl = options.dexBackendBaseUrl.replace(/\/$/u, '');
    this.requestor = options.httpRequestor;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.positionConfirmation = options.positionConfirmation;
  }

  /** Confirm a trade through explore or poll the affected position for a liquidity write.
   *
   * @example
   * ```ts
   * const indexed = await submitted.confirm({ timeoutMs: 60_000 });
   * ```
   */
  public async confirm(options?: ConfirmOptions): Promise<TConfirmation> {
    if (this.method !== 'Trade') return this.confirmPosition(options) as Promise<TConfirmation>;
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const pollIntervalMs = Math.max(500, options?.pollIntervalMs ?? 2_500);
    const startedAt = Date.now();
    const url = `${this.backendBaseUrl}/explore/transaction?uniqueKey=${encodeURIComponent(this.uniqueKey)}`;
    let attempt = 0;

    while (Date.now() - startedAt <= timeoutMs) {
      const response = await requestWithTimeout(
        this.requestor,
        url,
        { method: 'GET' },
        this.requestTimeoutMs,
      );
      const body = await readResponseBody(response);
      if (response.ok) {
        const envelope = asRecord(body);
        const data = asRecord(envelope?.['data']) ?? envelope;
        if (data === undefined) {
          throw new GSwapSDKError(
            'Transaction confirmation returned a malformed body',
            'CONFIRMATION_FAILED',
            { status: response.status, body, url },
          );
        }
        return { ...data, uniqueKey: this.uniqueKey } as TConfirmation;
      }

      if (
        this.transactionId !== null &&
        this.blockNumber !== null &&
        isPendingExploreResponse(response.status, body)
      ) {
        return null as TConfirmation;
      }

      const retryAfter = response.status === 429 ? readRetryAfter(response) : undefined;
      if (retryAfter !== undefined) {
        const waitMs = retryAfter;
        if (Date.now() - startedAt + waitMs > timeoutMs) break;
        await delay(waitMs);
        continue;
      }
      if (!isPendingExploreResponse(response.status, body)) {
        throw new GSwapSDKError(bodyMessage(body), 'CONFIRMATION_FAILED', {
          status: response.status,
          body,
          url,
        });
      }
      const backoff = Math.min(30_000, pollIntervalMs * 2 ** Math.min(attempt, 5));
      const waitMs = jitter(backoff);
      attempt += 1;
      if (Date.now() - startedAt + waitMs > timeoutMs) break;
      await delay(waitMs);
    }

    throw GSwapSDKError.confirmationTimeoutError(this.uniqueKey);
  }

  private async confirmPosition(options?: ConfirmOptions): Promise<Position | null> {
    if (this.positionConfirmation === undefined) return null;
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const pollIntervalMs = Math.max(500, options?.pollIntervalMs ?? 2_500);
    const startedAt = Date.now();
    let attempt = 0;
    while (Date.now() - startedAt <= timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const position = await this.positionConfirmation(controller.signal);
        if (position !== null) return position;
      } finally {
        clearTimeout(timer);
      }
      const waitMs = jitter(Math.min(30_000, pollIntervalMs * 2 ** Math.min(attempt, 5)));
      attempt += 1;
      if (Date.now() - startedAt + waitMs > timeoutMs) break;
      await delay(waitMs);
    }
    throw GSwapSDKError.confirmationTimeoutError(this.uniqueKey);
  }
}

/** Controls timeout and polling behavior for indexed confirmation. */
export interface ConfirmOptions {
  timeoutMs?: number | undefined;
  pollIntervalMs?: number | undefined;
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

function jitter(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds * (0.9 + Math.random() * 0.2)));
}

function isPendingExploreResponse(status: number, body: unknown): boolean {
  const record = asRecord(body);
  return (
    status === 404 &&
    record?.['error'] === true &&
    bodyMessage(body) === 'No indexed transaction for that uniqueKey yet'
  );
}

function readRetryAfter(response: {
  headers?: { get(name: string): string | null } | Record<string, string | undefined>;
}): number | undefined {
  const headers = response.headers;
  if (headers === undefined) return undefined;
  const raw =
    'get' in headers && typeof headers.get === 'function'
      ? headers.get('retry-after')
      : findRetryAfter(headers as Record<string, string | undefined>);
  if (raw === null || raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function findRetryAfter(headers: Record<string, string | undefined>): string | undefined {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
}
