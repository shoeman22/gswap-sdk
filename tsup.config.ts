import { defineConfig } from 'tsup';
import packageJson from './package.json';

export default defineConfig([
  // Node.js build (CommonJS and ESM)
  {
    name: 'node',
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: {
      compilerOptions: {
        incremental: false,
      },
    },
    splitting: false,
    sourcemap: true,
    clean: true,
    minify: false,
    target: 'node16',
    platform: 'node',
    external: ['@gala-chain/api', 'bignumber.js'],
    outDir: 'dist',
    define: {
      __GSWAP_SDK_VERSION__: JSON.stringify(packageJson.version),
    },
    outExtension({ format }) {
      return {
        js: format === 'cjs' ? '.cjs' : '.mjs',
      };
    },
    onSuccess: async () => {
      console.log('✅ Node.js build completed successfully');
    },
  },
  // Browser build (for bundlers like Webpack, Vite, etc.)
  {
    name: 'browser',
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false, // Don't generate types twice
    splitting: false,
    sourcemap: true,
    clean: false, // Don't clean since we build node first
    minify: true,
    target: 'es2020',
    platform: 'browser',
    external: ['@gala-chain/api', 'bignumber.js'],
    outDir: 'dist/browser',
    outExtension() {
      return {
        js: '.js',
      };
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __GSWAP_SDK_VERSION__: JSON.stringify(packageJson.version),
    },
    esbuildOptions(options) {
      // Provide browser polyfills for Node.js built-ins
      options.alias = {
        ...options.alias,
        crypto: 'crypto-browserify',
        events: 'events',
      };
    },
    onSuccess: async () => {
      console.log('✅ Browser build completed successfully');
    },
  },
]);
