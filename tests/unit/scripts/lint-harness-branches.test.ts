import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-harness-branches.sh', import.meta.url);
const BASELINE_HEADER = [
  '# Harness-name branch ratchet baseline (PAN-4562). Rows: <count> <path>.',
  '# Lower with: bash scripts/lint-harness-branches.sh --update',
];

type GuardResult = { ok: boolean; output: string };

function makeTempGuard(files: Record<string, string>, baselineRows: string[] | null): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-harness-branches-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lint-harness-branches.sh'), readFileSync(SCRIPT_SOURCE, 'utf-8'));
  writeSources(root, files);
  if (baselineRows) {
    writeFileSync(baselinePath(root), `${[...BASELINE_HEADER, ...baselineRows].join('\n')}\n`);
  }
  return root;
}

function writeSources(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function baselinePath(root: string): string {
  return join(root, 'scripts', 'harness-branches-baseline.txt');
}

function baselineRowsOf(root: string): string[] {
  return readFileSync(baselinePath(root), 'utf-8').split('\n').filter((line) => line && !line.startsWith('#'));
}

function runGuard(root: string, args: string[] = []): GuardResult {
  try {
    const output = execFileSync('bash', [join(root, 'scripts', 'lint-harness-branches.sh'), ...args], {
      cwd: root,
      encoding: 'utf-8',
    });
    return { ok: true, output };
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string };
    return { ok: false, output: [result.stdout ?? '', result.stderr ?? ''].join('\n') };
  }
}

const TWO_BRANCHES = "if (harness === 'acp' || harness === 'opencode') stop();\n";
const ONE_BRANCH = "const isCodex = conv.harness === 'codex';\n";

describe('lint-harness-branches.sh', () => {
  it('(a) passes when every count equals its baseline row', () => {
    const root = makeTempGuard({ 'src/lib/a.ts': TWO_BRANCHES, 'src/lib/b.ts': ONE_BRANCH }, ['2 src/lib/a.ts', '1 src/lib/b.ts']);

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('✓ harness-branch ratchet passed (3 in 2 files; none new)');
  });

  it('(b) fails and names the file when a file gains a branch', () => {
    const root = makeTempGuard({ 'src/lib/a.ts': TWO_BRANCHES, 'src/lib/b.ts': ONE_BRANCH }, ['1 src/lib/a.ts', '1 src/lib/b.ts']);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('✖ src/lib/a.ts: 2 harness-name branches (baseline 1)');
    expect(result.output).not.toContain('src/lib/b.ts');
    expect(result.output).toContain('Replace the branch with a HarnessCapabilities field');
  });

  it('(c) fails on a new file with a match, marking it NEW', () => {
    const root = makeTempGuard({ 'src/lib/a.ts': TWO_BRANCHES, 'src/lib/new.tsx': ONE_BRANCH }, ['2 src/lib/a.ts']);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('✖ src/lib/new.tsx: NEW file with 1 harness-name branches');
  });

  it('passes a lowered count and suggests --update without rewriting the baseline', () => {
    const root = makeTempGuard({ 'src/lib/b.ts': ONE_BRANCH }, ['3 src/lib/b.ts']);
    const before = readFileSync(baselinePath(root), 'utf-8');

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('lint-harness-branches.sh --update');
    expect(readFileSync(baselinePath(root), 'utf-8')).toBe(before);
  });

  it('(d) --update lowers a row, drops a zero row, and never adds or raises one', () => {
    const root = makeTempGuard(
      { 'src/lib/a.ts': TWO_BRANCHES, 'src/lib/b.ts': ONE_BRANCH, 'src/lib/new.ts': ONE_BRANCH },
      ['5 src/lib/a.ts', '2 src/lib/gone.ts', '1 src/lib/b.ts'],
    );

    const result = runGuard(root, ['--update']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('8 in 3 files → 3 in 2 files');
    expect(baselineRowsOf(root)).toEqual(['2 src/lib/a.ts', '1 src/lib/b.ts']);
    expect(runGuard(root).output).toContain('✖ src/lib/new.ts: NEW file');
    expect(readFileSync(baselinePath(root), 'utf-8').startsWith(`${BASELINE_HEADER.join('\n')}\n`)).toBe(true);
  });

  it('(e) ignores typeof checks, comment lines, harness-policy.ts and __tests__ files', () => {
    const root = makeTempGuard(
      {
        'src/lib/a.ts': [
          "if (typeof entry.harness === 'string') use(entry);",
          "// harness === 'codex' used to branch here",
          "  * harness === 'acp' in a doc comment",
          "/* transcriptKind === 'claude-jsonl' */",
        ].join('\n'),
        'src/lib/harness-policy.ts': ONE_BRANCH,
        'src/lib/__tests__/a.ts': ONE_BRANCH,
        'src/lib/a.test.ts': ONE_BRANCH,
        'src/lib/runtimes/codex.ts': ONE_BRANCH,
        'src/lib/runtimes/storage/x.ts': ONE_BRANCH,
      },
      [],
    );

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('(0 in 0 files; none new)');
  });

  it('(f) counts reversed operands, named harness variables and transcript kinds', () => {
    const root = makeTempGuard(
      {
        'src/lib/a.ts': [
          "if ('codex' === conv.harness) a();",
          "if (requestedHarness === 'pi') b();",
          "if (behavior.transcriptKind !== 'claude-jsonl') c();",
        ].join('\n'),
      },
      ['3 src/lib/a.ts'],
    );

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('(3 in 1 files; none new)');
  });

  it('a missing baseline fails the check and is initialized by --update', () => {
    const root = makeTempGuard({ 'src/lib/b.ts': ONE_BRANCH, 'src/lib/a.ts': TWO_BRANCHES }, null);

    const check = runGuard(root);
    expect(check.ok).toBe(false);
    expect(check.output).toContain('missing scripts/harness-branches-baseline.txt');
    expect(existsSync(baselinePath(root))).toBe(false);

    const init = runGuard(root, ['--update']);
    expect(init.ok).toBe(true);
    expect(init.output).toContain('baseline initialized (3 in 2 files)');
    expect(baselineRowsOf(root)).toEqual(['2 src/lib/a.ts', '1 src/lib/b.ts']);
    expect(runGuard(root).ok).toBe(true);
  });
});
