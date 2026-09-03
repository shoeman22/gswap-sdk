import type { HTTPResponse, HttpRequestor } from '../types/http_requestor.js';
import { GSwapSDKError, parseJson } from '../classes/gswap_sdk_error.js';

export async function requestWithTimeout(
  requestor: HttpRequestor,
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<HTTPResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const abortFromCaller = (): void => controller.abort();
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    return await requestor(url, { ...options, signal: controller.signal });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new GSwapSDKError(`Request timed out after ${timeoutMs} ms.`, 'REQUEST_TIMEOUT', {
        url,
        timeoutMs,
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function readResponseBody(response: HTTPResponse): Promise<unknown> {
  const text = await response.text();
  return parseJson(text) ?? text;
}
