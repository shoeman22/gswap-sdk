import type { HttpRequestor } from '../types/http_requestor.js';
import { debugLog } from '../utils/debug.js';
import { GSwapSDKError } from './gswap_sdk_error.js';
import { readResponseBody, requestWithTimeout } from '../utils/transport.js';
import { SDK_VERSION } from '../version.js';

export class HttpClient {
  /** Create an HTTP client around fetch or an injected requestor. */
  constructor(
    private readonly httpRequestor: HttpRequestor = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  private async sendRequest<TReturnType>(
    method: 'POST' | 'GET',
    baseUrl: string,
    basePath: string,
    endpoint: string,
    body?: unknown,
    options?: Pick<RequestInit, 'signal'>,
  ): Promise<TReturnType> {
    const url = `${baseUrl}${basePath}${endpoint}`;
    debugLog(`Sending request to ${url} with body:`, body);

    const response = await requestWithTimeout(
      this.httpRequestor,
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `GalaChain-SDK/${SDK_VERSION}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      },
      this.timeoutMs,
    );

    if (!response.ok) {
      throw await GSwapSDKError.fromErrorResponse(url, response);
    }

    const json = await readResponseBody(response);
    debugLog(`Response from ${baseUrl}${basePath}${endpoint}:`, json);

    return json as TReturnType;
  }

  /** Send a JSON POST request and decode its response. */
  async sendPostRequest<TReturnType>(
    baseUrl: string,
    basePath: string,
    endpoint: string,
    body: unknown,
  ): Promise<TReturnType> {
    return this.sendRequest('POST', baseUrl, basePath, endpoint, body);
  }

  /** Send a GET request with URL-encoded query parameters and decode its response. */
  async sendGetRequest<TReturnType>(
    baseUrl: string,
    basePath: string,
    endpoint: string,
    params?: Record<string, string>,
    options?: Pick<RequestInit, 'signal'>,
  ): Promise<TReturnType> {
    const searchParams = params ? new URLSearchParams(params) : undefined;
    const endpointWithParams = searchParams ? `${endpoint}?${searchParams.toString()}` : endpoint;

    return this.sendRequest('GET', baseUrl, basePath, endpointWithParams, undefined, options);
  }
}
