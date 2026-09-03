import type { HttpRequestor, HTTPResponse } from '../types/http_requestor.js';
import {
  getObjectProperty,
  getStringProperty,
  parseJson,
  GSwapSDKError,
} from './gswap_sdk_error.js';
import { SubmittedTransaction } from './submitted_transaction.js';

/** Options for a chain-gateway client. */
export interface ChainGatewayOptions {
  gatewayBaseUrl: string;
  dexContractBasePath: string;
  dexBackendBaseUrl: string;
  httpRequestor?: HttpRequestor;
  walletAddress?: string;
  chainCallTimeoutMs?: number;
}

/** Thin client for unsigned GalaChainDex reads and synchronous v2 writes. */
export class ChainGateway {
  private readonly requestor: HttpRequestor;
  private readonly walletAddress: string | undefined;
  private readonly chainCallTimeoutMs: number;
  public readonly gatewayBaseUrl: string;
  public readonly dexContractBasePath: string;
  public readonly dexBackendBaseUrl: string;

  /** Create a chain gateway client. */
  constructor(options: ChainGatewayOptions) {
    this.gatewayBaseUrl = trimTrailingSlash(options.gatewayBaseUrl);
    this.dexContractBasePath = normalizePath(options.dexContractBasePath);
    this.dexBackendBaseUrl = trimTrailingSlash(options.dexBackendBaseUrl);
    this.requestor = options.httpRequestor ?? fetch.bind(globalThis);
    this.walletAddress = options.walletAddress;
    this.chainCallTimeoutMs = options.chainCallTimeoutMs ?? 30_000;
  }

  /** Submit a signed v2 DTO through the chain gateway. */
  public async submit(
    method: string,
    signedBody: Record<string, unknown>,
    options?: { walletAddress?: string },
  ): Promise<SubmittedTransaction> {
    const url = `${this.dexBackendBaseUrl}/v1/chain/asset/dex-contract/${method}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const walletAddress = options?.walletAddress ?? this.walletAddress;
    if (walletAddress !== undefined) headers['X-Wallet-Address'] = walletAddress;
    const response = await this.requestor(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(signedBody),
    });
    const body = await readBody(response);

    if (!response.ok) {
      throw gatewayError(response, body, url);
    }

    const envelope = asRecord(body);
    const data = asRecord(envelope?.['data']) ?? envelope;
    const transactionId = getStringProperty(data, 'transactionId');
    const mode = getStringProperty(data, 'mode');
    if (mode !== undefined && mode !== 'sync') {
      throw new GSwapSDKError(
        `Unsupported gateway transaction mode: ${mode}`,
        'INVALID_GATEWAY_RESPONSE',
        {
          status: response.status,
          body,
          url,
        },
      );
    }

    const uniqueKey = getStringProperty(signedBody, 'uniqueKey') ?? '';
    return new SubmittedTransaction({
      method,
      uniqueKey,
      transactionId: transactionId === undefined || transactionId === '' ? null : transactionId,
      result: data?.['result'],
      dexBackendBaseUrl: this.dexBackendBaseUrl,
      httpRequestor: this.requestor,
      chainCallTimeoutMs: this.chainCallTimeoutMs,
    });
  }

  /** Execute an unsigned GalaChainDex read and unwrap its `Data` payload. */
  public async chainRead<T>(method: string, dto: unknown): Promise<T> {
    const url = `${this.gatewayBaseUrl}${this.dexContractBasePath}/${method}`;
    const response = await this.requestor(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dto),
    });
    const body = await readBody(response);
    if (!response.ok) throw gatewayError(response, body, url);

    const envelope = asRecord(body);
    const nestedError = getObjectProperty(body, 'error');
    const errorKey =
      getStringProperty(envelope, 'ErrorKey') ?? getStringProperty(nestedError, 'ErrorKey');
    const message =
      getStringProperty(envelope, 'Message') ?? getStringProperty(nestedError, 'Message');
    const status = envelope?.['Status'];
    if (status === 0 || (errorKey !== undefined && message !== undefined)) {
      throw GSwapSDKError.fromChainError(
        errorKey ?? 'CHAIN_ERROR',
        message ?? 'Chain read failed',
        {
          status: response.status,
          body,
          url,
        },
      );
    }
    if (status !== 1) {
      throw new GSwapSDKError('Unexpected chain read response.', 'INVALID_CHAIN_RESPONSE', {
        status: response.status,
        body,
        url,
      });
    }

    return (envelope?.['Data'] ?? envelope?.['data']) as T;
  }

  /** Fetch every page from a cursor-based chain read. */
  public async pageAll<T>(method: string, dto: Record<string, unknown> = {}): Promise<T[]> {
    const values: T[] = [];
    let bookmark: string | undefined;
    do {
      const requestDto = bookmark === undefined ? dto : { ...dto, bookmark };
      const page = await this.chainRead<unknown>(method, requestDto);
      const pageObject = asRecord(page);
      const results = Array.isArray(page)
        ? page
        : Array.isArray(pageObject?.['results'])
          ? pageObject['results']
          : [];
      values.push(...(results as T[]));
      const next = pageObject?.['nextPageBookmark'];
      bookmark = typeof next === 'string' && next !== '' ? next : undefined;
    } while (bookmark !== undefined);
    return values;
  }

  /** Expose the requestor for sibling read services that share this gateway transport. */
  public get httpRequestor(): HttpRequestor {
    return this.requestor;
  }
}

async function readBody(response: HTTPResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return parseJson(await response.text());
  }
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/u, '');
}

function normalizePath(value: string): string {
  return `/${value.replace(/^\//u, '').replace(/\/$/u, '')}`;
}
