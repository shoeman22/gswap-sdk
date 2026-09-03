declare const __GSWAP_SDK_VERSION__: string | undefined;

/** Package version embedded by tsup, with a source-test fallback. */
export const SDK_VERSION =
  typeof __GSWAP_SDK_VERSION__ === 'string' ? __GSWAP_SDK_VERSION__ : '1.0.0-rc.1';
