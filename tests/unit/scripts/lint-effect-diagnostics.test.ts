import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-effect-diagnostics.sh', import.meta.url);
const BASELINE_HEADER = [
  '# Effect diagnostics baseline for lint-effect-diagnostics.sh (PAN-3568).',
  '# One finding ending in effect(<ruleName>) per row, sorted. Lower with: bash scripts/lint-effect-diagnostics.sh --update',
];
const EFFECT_FINDING = 'src/x.ts(1,1): error TS3: Effect must be yielded.    effect(floatingEffect)';
const PLAIN_TYPE_ERROR = "src/x.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.";

type GuardResult = { ok: boolean; output: string };

function makeTempGuard(baselineFindings: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-effect-diagnostics-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });

  writeFileSync(
    join(root, 'scripts', 'lint-effect-diagnostics.sh'),
    readFileSync(SCRIPT_SOURCE, 'utf-8'),
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'scripts', 'effect-diagnostics-baseline.txt'),
    `${[...BASELINE_HEADER, ...baselineFindings.sort()].join('\n')}\n`,
  );
  writeFileSync(
    join(root, 'node_modules', '.bin', 'effect-language-service'),
    '#!/usr/bin/env bash\nexit 0\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'node_modules', '.bin', 'tsc'),
    '#!/usr/bin/env bash\ncat "$FAKE_TSC_OUTPUT"\nexit "${FAKE_TSC_EXIT:-0}"\n',
    { mode: 0o755 },
  );
  writeFileSync(join(root, 'tsc-output.txt'), '');

  return root;
}

function writeTscOutput(root: string, output: string): void {
  writeFileSync(join(root, 'tsc-output.txt'), `${output}\n`);
}

function runGuard(root: string, args: string[] = [], tscExit = 0): GuardResult {
  try {
    const output = execFileSync('bash', [join(root, 'scripts', 'lint-effect-diagnostics.sh'), ...args], {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        FAKE_TSC_OUTPUT: join(root, 'tsc-output.txt'),
        FAKE_TSC_EXIT: String(tscExit),
      },
    });
    return { ok: true, output };
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: [result.stdout ?? '', result.stderr ?? ''].join('\n'),
    };
  }
}

describe('lint-effect-diagnostics.sh', () => {
  it('labels an unbaselined Effect finding as NEW', () => {
    const root = makeTempGuard([]);
    writeTscOutput(root, EFFECT_FINDING);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('NEW: src/x.ts: error TS3: Effect must be yielded.    effect(floatingEffect)');
  });

  it('ignores a plain TypeScript error with no Effect marker', () => {
    const root = makeTempGuard([]);
    writeTscOutput(root, PLAIN_TYPE_ERROR);

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('✓ Effect diagnostics guard passed (0 known findings; none new)');
  });

  it('lowers the baseline with --update', () => {
    const root = makeTempGuard(Array.from({ length: 5 }, () => EFFECT_FINDING));
    const baselinePath = join(root, 'scripts', 'effect-diagnostics-baseline.txt');
    writeTscOutput(root, EFFECT_FINDING);

    const result = runGuard(root, ['--update']);
    const updated = readFileSync(baselinePath, 'utf-8');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('baseline updated: 5 → 4');
    expect(updated.match(/effect\(floatingEffect\)/g)).toHaveLength(4);
  });

  it('refuses to raise the baseline with --update and leaves it unchanged', () => {
    const root = makeTempGuard(Array.from({ length: 3 }, () => EFFECT_FINDING));
    const baselinePath = join(root, 'scripts', 'effect-diagnostics-baseline.txt');
    const before = readFileSync(baselinePath, 'utf-8');
    writeTscOutput(root, EFFECT_FINDING);

    const result = runGuard(root, ['--update']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('refusing to raise the baseline');
    expect(readFileSync(baselinePath, 'utf-8')).toBe(before);
  });

  it('reports a crashed diagnostics lane instead of silently passing zero findings', () => {
    const root = makeTempGuard([]);
    writeTscOutput(root, 'simulated compiler crash');

    const result = runGuard(root, [], 137);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Effect diagnostics lane 'root' failed (exit 137) without TypeScript diagnostics");
    expect(result.output).toContain('simulated compiler crash');
  });
});
