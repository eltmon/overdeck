import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/guard-allowlist-raise.sh', import.meta.url);
const HELPER_SOURCE = new URL('../../../scripts/lib/pusher-identity.sh', import.meta.url);

function makeTempRepo(userName = 'panopticon-agent[bot]'): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-allowlist-raise-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', userName], { cwd: root });
  return root;
}

function installScript(root: string): void {
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'guard-allowlist-raise.sh'), readFileSync(SCRIPT_SOURCE, 'utf-8'), {
    mode: 0o755,
  });
  writeFileSync(join(root, 'scripts', 'lib', 'pusher-identity.sh'), readFileSync(HELPER_SOURCE, 'utf-8'), {
    mode: 0o755,
  });
}

function writeLines(root: string, path: string, count: number): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, Array.from({ length: count }, (_, i) => `line ${i}`).join('\n') + '\n');
}

function writeAllowlist(root: string, rows: string[]): void {
  writeFileSync(join(root, 'scripts', 'file-size-allowlist.txt'), rows.join('\n') + '\n');
}

function commitAll(root: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', message, '--quiet'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}

function setupRepo(userName?: string): { root: string; base: string } {
  const root = makeTempRepo(userName);
  installScript(root);
  writeLines(root, 'src/x.ts', 1012);
  writeAllowlist(root, ['1012 src/x.ts # PAN-1']);
  const base = commitAll(root, 'base PAN-0000');
  return { root, base };
}

function runGuard(
  root: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'guard-allowlist-raise.sh');
  const nextEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of ['OVERDECK_CONVERSATION', 'OVERDECK_AGENT_STARTED_BY', 'OVERDECK_OPERATOR_PUSH']) {
    delete nextEnv[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = value;
    }
  }

  try {
    const output = execFileSync('bash', [script, ...args], {
      cwd: root,
      encoding: 'utf-8',
      env: nextEnv,
    });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('guard-allowlist-raise.sh', () => {
  it('refuses a raise from an agent and names the path and caps', () => {
    const { root, base } = setupRepo();
    writeLines(root, 'src/x.ts', 1018);
    writeAllowlist(root, ['1018 src/x.ts # PAN-1']);
    const head = commitAll(root, 'raise cap');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('src/x.ts 1012 → 1018');
  });

  it('refuses the same raise for conv-flywheel', () => {
    const { root, base } = setupRepo();
    writeLines(root, 'src/x.ts', 1018);
    writeAllowlist(root, ['1018 src/x.ts # PAN-1']);
    const head = commitAll(root, 'raise cap');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'conv-flywheel' });

    expect(result.ok).toBe(false);
  });

  it('allows the same raise for an operator conversation (conv-*)', () => {
    const { root, base } = setupRepo();
    writeLines(root, 'src/x.ts', 1018);
    writeAllowlist(root, ['1018 src/x.ts # PAN-1']);
    const head = commitAll(root, 'raise cap');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'conv-123' });

    expect(result.ok).toBe(true);
  });

  it('allows the same raise with the operator escape hatch', () => {
    const { root, base } = setupRepo();
    writeLines(root, 'src/x.ts', 1018);
    writeAllowlist(root, ['1018 src/x.ts # PAN-1']);
    const head = commitAll(root, 'raise cap');

    const result = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'agent-pan-1',
      OVERDECK_OPERATOR_PUSH: '1',
    });

    expect(result.ok).toBe(true);
  });

  it('allows lowering a cap alongside shrinking the file', () => {
    const { root, base } = setupRepo();
    writeLines(root, 'src/x.ts', 900);
    writeAllowlist(root, ['900 src/x.ts # PAN-1']);
    const head = commitAll(root, 'shrink and lower cap');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(true);
  });

  it('refuses an appended later row for the same path (last row wins)', () => {
    const { root, base } = setupRepo();
    writeAllowlist(root, ['1012 src/x.ts # PAN-1', '1018 src/x.ts # PAN-2']);
    const head = commitAll(root, 'append higher row for same path');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(false);
  });

  it('refuses a new row above CEILING for a path absent at base', () => {
    const { root, base } = setupRepo();
    writeAllowlist(root, ['1012 src/x.ts # PAN-1', '1100 src/new.ts # PAN-3']);
    const head = commitAll(root, 'add row for new path above ceiling');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('src/new.ts 1000 → 1100');
  });

  it('allows a new row at CEILING for a path absent at base', () => {
    const { root, base } = setupRepo();
    writeAllowlist(root, ['1012 src/x.ts # PAN-1', '1000 src/new.ts # PAN-3']);
    const head = commitAll(root, 'add row for new path at ceiling');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(true);
  });

  it('allows a new row at the allowance of a pre-existing over-ceiling file with no base row', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/x.ts', 1012);
    writeAllowlist(root, ['1012 src/x.ts # PAN-1']);
    writeLines(root, 'src/big.ts', 1200);
    const base = commitAll(root, 'base PAN-0000');
    writeAllowlist(root, ['1012 src/x.ts # PAN-1', '1200 src/big.ts # PAN-4']);
    const head = commitAll(root, 'add allowlist row at allowance');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(true);
  });

  it('refuses a new row above the allowance of a pre-existing over-ceiling file with no base row', () => {
    const root = makeTempRepo();
    installScript(root);
    writeLines(root, 'src/x.ts', 1012);
    writeAllowlist(root, ['1012 src/x.ts # PAN-1']);
    writeLines(root, 'src/big.ts', 1200);
    const base = commitAll(root, 'base PAN-0000');
    writeAllowlist(root, ['1012 src/x.ts # PAN-1', '1250 src/big.ts # PAN-4']);
    const head = commitAll(root, 'add allowlist row above allowance');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(false);
  });

  it('grandfathers a raise already on the remote tip via --prior', () => {
    const { root, base } = setupRepo();
    writeLines(root, 'src/x.ts', 1018);
    writeAllowlist(root, ['1018 src/x.ts # PAN-1']);
    const priorRaise = commitAll(root, 'operator raise to 1018');
    writeFileSync(join(root, 'README.md'), 'unrelated change\n');
    const head = commitAll(root, 'unrelated follow-up');

    const withPrior = runGuard(root, ['--range', `${base}..${head}`, '--prior', priorRaise], {
      OVERDECK_AGENT_ID: 'agent-pan-1',
    });
    expect(withPrior.ok).toBe(true);

    const withoutPrior = runGuard(root, ['--range', `${base}..${head}`], {
      OVERDECK_AGENT_ID: 'agent-pan-1',
    });
    expect(withoutPrior.ok).toBe(false);
  });

  it('exits 0 for a range that does not touch the allowlist', () => {
    const { root, base } = setupRepo();
    writeFileSync(join(root, 'src', 'unrelated.ts'), 'export const a = 1;\n');
    const head = commitAll(root, 'unrelated change');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(true);
  });

  it('fails closed for an empty range argument', () => {
    const { root } = setupRepo();

    const result = runGuard(root, ['--range', ''], { OVERDECK_AGENT_ID: 'agent-pan-1' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('trust gate');
  });

  it('allows a raise for a human pusher with no agent env', () => {
    const { root, base } = setupRepo('Human Operator');
    writeLines(root, 'src/x.ts', 1018);
    writeAllowlist(root, ['1018 src/x.ts # PAN-1']);
    const head = commitAll(root, 'raise cap as human');

    const result = runGuard(root, ['--range', `${base}..${head}`], { OVERDECK_AGENT_ID: undefined });

    expect(result.ok).toBe(true);
  });
});
