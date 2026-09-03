import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'gswap-sdk-pack-'));
try {
  const packed = execFileSync('npm', ['pack', '--silent', '--pack-destination', directory], {
    encoding: 'utf8',
  }).trim();
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-package-lock', join(directory, packed)],
    {
      cwd: directory,
      stdio: 'inherit',
    },
  );
  const requireFromPack = createRequire(join(directory, 'probe.cjs'));
  const required: unknown = requireFromPack('@gala-chain/gswap-sdk');
  if (typeof required !== 'object' || required === null)
    throw new Error('require() returned no package object');
  const imported: unknown = await import(
    pathToFileURL(join(directory, 'node_modules/@gala-chain/gswap-sdk/dist/index.mjs')).href
  );
  if (typeof imported !== 'object' || imported === null)
    throw new Error('import() returned no package object');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
