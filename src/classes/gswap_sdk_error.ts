import { GalaChainTokenClassKey } from '../types/token.js';
import { HTTPResponse } from '../types/http_requestor.js';

/** Error raised by the SDK for validation, gateway, chain, or transaction failures. */
export class GSwapSDKError extends Error {
  public readonly chainMessage: string | undefined;
  public readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    chainMessage?: string,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GSwapSDKError';
    this.chainMessage = chainMessage;
    this.retryAfterMs = retryAfterMs;
  }

  /** Create the standard missing-signer error. */
  public static noSignerError(): GSwapSDKError {
    return new GSwapSDKError(
      'This method requires a signer. Please provide a signer to the GSwap constructor.',
      'NO_SIGNER',
    );
  }

  /** Convert a chain-gateway bounce into a typed SDK error. */
  public static fromGatewayBounce(
    code: string,
    message: string,
    status: number,
    retryAfterMs?: number,
  ): GSwapSDKError {
    const details: Record<string, unknown> = { status, chainMessage: message };
    if (retryAfterMs !== undefined) details.retryAfterMs = retryAfterMs;
    const sdkMessage =
      code === 'CHAIN_DISPATCH_FAILED' ? message : `Gateway rejected ${code}: ${message}`;
    return new GSwapSDKError(sdkMessage, code, details, message, retryAfterMs);
  }

  /** Convert a GalaChain `Status: 0` response into a typed SDK error. */
  public static fromChainError(
    errorKey: string,
    message: string,
    details?: Record<string, unknown>,
  ): GSwapSDKError {
    return new GSwapSDKError(
      `GalaChain error ${errorKey}: ${message}`,
      errorKey,
      { ...details, errorKey, message },
      message,
    );
  }

  /** Create the error used when a token is not registered by the current DEX contract. */
  public static unknownTokenError(token: GalaChainTokenClassKey | string): GSwapSDKError {
    const tokenText = typeof token === 'string' ? token : JSON.stringify(token);
    return new GSwapSDKError(
      `Token ${tokenText} has no trading symbol on the new DEX contract (no gcdex pool includes it yet).`,
      'UNKNOWN_TOKEN',
      { token },
    );
  }

  /** Create the error used when indexed confirmation does not arrive in time. */
  public static confirmationTimeoutError(uniqueKey: string): GSwapSDKError {
    return new GSwapSDKError('Transaction confirmation timed out.', 'CONFIRMATION_TIMEOUT', {
      uniqueKey,
    });
  }

  /** Create the error used when caller-supplied token order is invalid. */
  public static incorrectTokenOrderingError(
    specifiedToken0: GalaChainTokenClassKey | string,
    specifiedToken1: GalaChainTokenClassKey | string,
  ): GSwapSDKError {
    return new GSwapSDKError(
      'Token ordering is incorrect. token0 should sort below token1.',
      'INCORRECT_TOKEN_ORDERING',
      { specifiedToken0, specifiedToken1 },
    );
  }

  /** Convert an unexpected HTTP response into an SDK error. */
  public static async fromErrorResponse(
    url: string,
    response: HTTPResponse,
  ): Promise<GSwapSDKError> {
    const bodyText = await response.text();
    const bodyJson: unknown = parseJson(bodyText);
    const errorObject = getObjectProperty(bodyJson, 'error');
    const errorKey = getStringProperty(errorObject, 'ErrorKey');
    const message = getStringProperty(errorObject, 'Message');

    if (errorKey !== undefined && message !== undefined) {
      return new GSwapSDKError(
        `GalaChain Error ${errorKey} from ${url}: ${message}`,
        errorKey,
        { message, errorKey, status: response.status, body: bodyJson, url },
        message,
      );
    }

    return new GSwapSDKError(`Unexpected HTTP Error ${response.status} from ${url}`, 'HTTP_ERROR', {
      status: response.status,
      body: bodyJson ?? bodyText,
      url,
    });
  }
}

/** Narrow an object property without trusting a cast at a network boundary. */
export function getObjectProperty(
  value: unknown,
  property: string,
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) return undefined;
  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'object' && propertyValue !== null
    ? (propertyValue as Record<string, unknown>)
    : undefined;
}

/** Read a string property from an unknown object. */
export function getStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) return undefined;
  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'string' ? propertyValue : undefined;
}

/** Parse a response body, preserving non-JSON text for error reporting. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
