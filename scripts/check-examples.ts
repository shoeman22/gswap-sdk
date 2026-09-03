import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageDirectory = mkdtempSync(join(tmpdir(), 'gswap-sdk-examples-'));
try {
  const archive = execFileSync(
    'npm',
    ['pack', '--silent', '--pack-destination', packageDirectory],
    {
      encoding: 'utf8',
    },
  ).trim();
  for (const example of ['examples/cli', 'examples/full_dex']) {
    execFileSync(
      'npm',
      [
        'install',
        '--no-save',
        '--no-package-lock',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        join(packageDirectory, archive),
      ],
      { cwd: join(process.cwd(), example), stdio: 'inherit' },
    );
    execFileSync('npm', ['run', 'build'], { cwd: join(process.cwd(), example), stdio: 'inherit' });
  }
} finally {
  rmSync(packageDirectory, { recursive: true, force: true });
}
