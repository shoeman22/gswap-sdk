import type { HttpRequestor, HTTPResponse } from '../types/http_requestor.js';
import { getObjectProperty, getStringProperty, GSwapSDKError } from './gswap_sdk_error.js';
import { SubmittedTransaction } from './submitted_transaction.js';
import { readResponseBody, requestWithTimeout } from '../utils/transport.js';
import type { IndexedTransaction, Position } from '../types/v2_results.js';

/** Options for a chain-gateway client. */
export interface ChainGatewayOptions {
  dexBackendBaseUrl: string;
  httpRequestor?: HttpRequestor | undefined;
  walletAddress?: string | undefined;
  chainCallTimeoutMs?: number | undefined;
}

/** Optional attribution and operation-specific confirmation hooks for a write. */
export interface ChainSubmitOptions {
  walletAddress?: string | undefined;
  positionConfirmation?: ((signal: AbortSignal) => Promise<Position | null>) | undefined;
}

/** Thin client for backend-routed synchronous v2 writes. */
export class ChainGateway {
  private readonly requestor: HttpRequestor;
  private readonly walletAddress: string | undefined;
  private readonly chainCallTimeoutMs: number;
  public readonly requestTimeoutMs: number;
  public readonly dexBackendBaseUrl: string;

  /** Create a chain gateway client. */
  constructor(options: ChainGatewayOptions) {
    this.dexBackendBaseUrl = trimTrailingSlash(options.dexBackendBaseUrl);
    this.requestor = options.httpRequestor ?? fetch.bind(globalThis);
    this.walletAddress = options.walletAddress;
    this.chainCallTimeoutMs = options.chainCallTimeoutMs ?? 30_000;
    this.requestTimeoutMs = this.chainCallTimeoutMs;
  }

  /** Submit a signed v2 DTO through the chain gateway. */
  public async submit(
    method: 'Trade',
    signedBody: Record<string, unknown>,
    options?: ChainSubmitOptions,
  ): Promise<SubmittedTransaction<IndexedTransaction | null>>;
  public async submit(
    method: string,
    signedBody: Record<string, unknown>,
    options?: ChainSubmitOptions,
  ): Promise<SubmittedTransaction<IndexedTransaction | Position | null>>;
  public async submit(
    method: string,
    signedBody: Record<string, unknown>,
    options?: ChainSubmitOptions,
  ): Promise<SubmittedTransaction> {
    const url = `${this.dexBackendBaseUrl}/v1/chain/asset/dex-contract/${method}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const walletAddress = options?.walletAddress ?? this.walletAddress;
    if (walletAddress !== undefined) headers['X-Wallet-Address'] = walletAddress;
    let response: HTTPResponse;
    try {
      response = await requestWithTimeout(
        this.requestor,
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(signedBody),
        },
        this.chainCallTimeoutMs,
      );
    } catch (error: unknown) {
      if (error instanceof GSwapSDKError && error.code === 'REQUEST_TIMEOUT') {
        throw new GSwapSDKError(
          'The submission outcome is unknown because the gateway request timed out. Confirm before retrying.',
          'SUBMISSION_OUTCOME_UNKNOWN',
          { uniqueKey: getStringProperty(signedBody, 'uniqueKey') ?? '', cause: error },
        );
      }
      throw error;
    }
    const body = await readResponseBody(response);

    if (!response.ok) {
      throw gatewayError(response, body, url);
    }

    const envelope = asRecord(body);
    const data = asRecord(envelope?.['data'] ?? envelope?.['Data']);
    if (data === undefined) {
      throw invalidGatewayResponse(response, body, url, 'Expected a data object.');
    }
    const transactionId = getStringProperty(data, 'transactionId');
    const mode = getStringProperty(data, 'mode');
    const rawTransactionId = data['transactionId'];
    const bodyBlockNumber = data['blockNumber'];
    if (
      mode !== 'sync' ||
      !('result' in data) ||
      ('transactionId' in data && typeof rawTransactionId !== 'string') ||
      (bodyBlockNumber !== undefined && bodyBlockNumber !== null && !isBlockNumber(bodyBlockNumber))
    ) {
      throw new GSwapSDKError(
        'Gateway response must contain data.mode="sync", data.result, and a string transactionId when present.',
        'INVALID_GATEWAY_RESPONSE',
        {
          status: response.status,
          body,
          url,
        },
      );
    }

    const uniqueKey = getStringProperty(signedBody, 'uniqueKey') ?? '';
    const headerTransactionId = readHeader(response, 'x-transaction-id');
    const resolvedTransactionId =
      transactionId === undefined || transactionId === '' ? headerTransactionId : transactionId;
    const blockNumber: number | undefined =
      bodyBlockNumber === null || bodyBlockNumber === undefined
        ? readBlockNumberHeader(response)
        : isBlockNumber(bodyBlockNumber)
          ? bodyBlockNumber
          : undefined;
    return new SubmittedTransaction({
      method,
      uniqueKey,
      transactionId:
        resolvedTransactionId === undefined || resolvedTransactionId === ''
          ? null
          : resolvedTransactionId,
      blockNumber: blockNumber ?? null,
      result: data['result'],
      dexBackendBaseUrl: this.dexBackendBaseUrl,
      httpRequestor: this.requestor,
      requestTimeoutMs: this.chainCallTimeoutMs,
      ...(options?.positionConfirmation === undefined
        ? {}
        : { positionConfirmation: options.positionConfirmation }),
    });
  }

  /** Expose the requestor for sibling read services that share this gateway transport. */
  public get httpRequestor(): HttpRequestor {
    return this.requestor;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/u, '');
}

function invalidGatewayResponse(
  response: HTTPResponse,
  body: unknown,
  url: string,
  message: string,
): GSwapSDKError {
  return new GSwapSDKError(message, 'INVALID_GATEWAY_RESPONSE', {
    status: response.status,
    body,
    url,
  });
}

function gatewayError(response: HTTPResponse, body: unknown, url: string): GSwapSDKError {
  const object = asRecord(body);
  const nested = getObjectProperty(body, 'error');
  const code =
    getStringProperty(object, 'code') ??
    getStringProperty(nested, 'code') ??
    getStringProperty(nested, 'ErrorKey') ??
    'HTTP_ERROR';
  const message =
    getStringProperty(object, 'message') ??
    getStringProperty(nested, 'message') ??
    getStringProperty(nested, 'Message') ??
    (typeof body === 'string' ? body : `Gateway request failed with HTTP ${response.status}`);
  const retryAfterMs = response.status === 429 ? readRetryAfter(response) : undefined;
  if (code === 'HTTP_ERROR') {
    return new GSwapSDKError(message, code, { status: response.status, body, url });
  }
  return GSwapSDKError.fromGatewayBounce(code, message, response.status, retryAfterMs);
}

function readRetryAfter(response: HTTPResponse): number | undefined {
  const headers = response.headers;
  if (headers === undefined) return undefined;
  const raw =
    'get' in headers && typeof headers.get === 'function'
      ? headers.get('retry-after')
      : Object.entries(headers as Record<string, string | undefined>).find(
          ([name]) => name.toLowerCase() === 'retry-after',
        )?.[1];
  if (raw === null || raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isBlockNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function readHeader(response: HTTPResponse, name: string): string | undefined {
  const headers = response.headers;
  if (headers === undefined) return undefined;
  if (hasHeaderGetter(headers)) {
    const value = headers.get(name);
    return value === null || value === '' ? undefined : value;
  }
  const record = headers;
  const value = Object.entries(record).find(([key]) => key.toLowerCase() === name)?.[1];
  return value === undefined || value === '' ? undefined : value;
}

function hasHeaderGetter(
  headers: NonNullable<HTTPResponse['headers']>,
): headers is { get(name: string): string | null } {
  return 'get' in headers && typeof headers.get === 'function';
}

function readBlockNumberHeader(response: HTTPResponse): number | undefined {
  const value = readHeader(response, 'x-block-number');
  if (value === undefined) return undefined;
  const blockNumber = Number(value);
  return isBlockNumber(blockNumber) ? blockNumber : undefined;
}
