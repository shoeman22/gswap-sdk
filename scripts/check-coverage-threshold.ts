#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const METRICS = ['lines', 'statements', 'functions', 'branches'] as const;
type Metric = (typeof METRICS)[number];
type Coverage = Record<Metric, number>;

const TARGETS: Coverage = {
  lines: 98,
  statements: 98,
  functions: 100,
  branches: 95,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function readSummary(path: string): Coverage {
  const parsed = readJson(path);
  if (!isRecord(parsed) || !isRecord(parsed.total)) {
    throw new Error('Coverage summary must contain a total object.');
  }

  return Object.fromEntries(
    METRICS.map((metric) => {
      const entry = parsed.total[metric];
      const pct = isRecord(entry) ? entry.pct : undefined;
      return [metric, typeof pct === 'number' && Number.isFinite(pct) ? pct : 0];
    }),
  ) as Coverage;
}

function readBaseline(path: string): Coverage {
  const parsed = readJson(path);
  if (!isRecord(parsed)) throw new Error('Coverage baseline must be an object.');

  return Object.fromEntries(
    METRICS.map((metric) => {
      const value = parsed[metric];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Coverage baseline metric "${metric}" must be finite.`);
      }
      return [metric, value];
    }),
  ) as Coverage;
}

function parseEpsilon(value: string | undefined): number {
  if (value === undefined) return 0.05;
  const epsilon = Number(value);
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new Error(`Invalid coverage ratchet epsilon: "${value}"`);
  }
  return epsilon;
}

function main(): number {
  const summary = readSummary(resolve('coverage/coverage-summary.json'));
  const baseline = readBaseline(resolve('scripts/coverage-ratchet-baseline.json'));
  const epsilon = parseEpsilon(process.env.COV_RATCHET_EPSILON);
  let failed = false;

  for (const metric of METRICS) {
    const actual = summary[metric];
    const target = TARGETS[metric];
    const minimum = Math.max(target, baseline[metric] - epsilon);
    const ok = actual >= minimum;
    if (!ok) failed = true;
    console.log(
      `${metric}: ${actual.toFixed(2)}% (target: ${target.toFixed(2)}%, baseline: ${baseline[metric].toFixed(2)}%, epsilon: ${epsilon.toFixed(2)}%) ${ok ? 'OK' : 'FAIL'}`,
    );
  }

  return failed ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
