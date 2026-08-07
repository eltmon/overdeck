import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-frontend-types.sh', import.meta.url);
const BASELINE_HEADER = [
  '# frontend type-error baseline for lint-frontend-types.sh (PAN-3192).',
  "# One baselined 'error TS' line per row, sorted. Lower with: bash scripts/lint-frontend-types.sh --update",
];
const ERROR_A = "src/components/Existing.tsx(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
const ERROR_B = "src/components/New.tsx(20,7): error TS2339: Property 'missing' does not exist on type '{}'.";

type GuardResult = { ok: boolean; output: string };

function makeTempGuard(baselineErrors: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-frontend-types-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });

  writeFileSync(
    join(root, 'scripts', 'lint-frontend-types.sh'),
    readFileSync(SCRIPT_SOURCE, 'utf-8'),
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'scripts', 'frontend-types-baseline.txt'),
    `${[...BASELINE_HEADER, ...baselineErrors.sort()].join('\n')}\n`,
  );
  writeFileSync(
    join(root, 'node_modules', '.bin', 'tsc'),
    '#!/usr/bin/env bash\ncat "$FAKE_TSC_OUTPUT"\nexit "${FAKE_TSC_EXIT:-0}"\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'bin', 'npx'),
    '#!/usr/bin/env bash\nprintf "npx fallback invoked\\n" >&2\nexit 99\n',
    { mode: 0o755 },
  );
  writeFileSync(join(root, 'tsc-output.txt'), 'tsc diagnostic noise\n');

  return root;
}

function writeTscOutput(root: string, errors: string[]): void {
  writeFileSync(join(root, 'tsc-output.txt'), `tsc diagnostic noise\n${errors.join('\n')}\n`);
}

function runGuard(root: string, args: string[] = [], tscExit = 0): GuardResult {
  try {
    const output = execFileSync('bash', [join(root, 'scripts', 'lint-frontend-types.sh'), ...args], {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
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

describe('lint-frontend-types.sh', () => {
  it('passes when the current errors match the baseline', () => {
    const root = makeTempGuard([ERROR_A]);
    writeTscOutput(root, [ERROR_A]);

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('✓ frontend-types guard passed (1 known errors; none new)');
  });

  it('rejects growth and labels new and known errors separately', () => {
    const root = makeTempGuard([ERROR_A]);
    writeTscOutput(root, [ERROR_A, ERROR_B]);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("NEW: src/components/New.tsx: error TS2339: Property 'missing'");
    expect(result.output).toContain("known: src/components/Existing.tsx: error TS2322: Type 'string'");
  });

  it('reports a stale baseline on shrink and lowers it with --update', () => {
    const root = makeTempGuard([ERROR_A, ERROR_B]);
    writeTscOutput(root, [ERROR_A]);

    const stale = runGuard(root);
    const updated = runGuard(root, ['--update']);
    const checked = runGuard(root);

    expect(stale.ok).toBe(false);
    expect(stale.output).toContain('stale baseline');
    expect(updated.ok).toBe(true);
    expect(updated.output).toContain('baseline updated: 2 → 1');
    expect(readFileSync(join(root, 'scripts', 'frontend-types-baseline.txt'), 'utf-8')).toContain(ERROR_A);
    expect(readFileSync(join(root, 'scripts', 'frontend-types-baseline.txt'), 'utf-8')).not.toContain(ERROR_B);
    expect(checked.ok).toBe(true);
  });

  it('refuses to raise the baseline with --update', () => {
    const root = makeTempGuard([ERROR_A]);
    const baselinePath = join(root, 'scripts', 'frontend-types-baseline.txt');
    const before = readFileSync(baselinePath, 'utf-8');
    writeTscOutput(root, [ERROR_A, ERROR_B]);

    const result = runGuard(root, ['--update']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('refusing to raise the baseline');
    expect(readFileSync(baselinePath, 'utf-8')).toBe(before);
  });

  it('fails when the baseline file is missing', () => {
    const root = makeTempGuard([]);
    unlinkSync(join(root, 'scripts', 'frontend-types-baseline.txt'));

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('✖ missing scripts/frontend-types-baseline.txt');
  });

  it('fails when the compiler exits without TypeScript diagnostics', () => {
    const root = makeTempGuard([]);
    writeFileSync(join(root, 'tsc-output.txt'), 'simulated compiler crash\n');

    const result = runGuard(root, [], 137);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('typecheck command failed (exit 137) without TypeScript diagnostics');
    expect(result.output).toContain('simulated compiler crash');
  });

  it('fails when the local compiler is missing without falling back to npx', () => {
    const root = makeTempGuard([]);
    unlinkSync(join(root, 'node_modules', '.bin', 'tsc'));

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("missing node_modules/.bin/tsc — run 'bun install' first");
    expect(result.output).not.toContain('npx fallback invoked');
  });

  it('does not relabel a line-shifted known error as new', () => {
    const root = makeTempGuard([ERROR_A]);
    const shiftedErrorA = ERROR_A.replace('(10,5)', '(47,17)');
    writeTscOutput(root, [shiftedErrorA, ERROR_B]);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("NEW: src/components/New.tsx: error TS2339: Property 'missing'");
    expect(result.output).not.toContain('NEW: src/components/Existing.tsx');
    expect(result.output).toContain("known: src/components/Existing.tsx: error TS2322: Type 'string'");
  });
});
