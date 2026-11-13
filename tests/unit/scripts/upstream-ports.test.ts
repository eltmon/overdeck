import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const SCRIPT = resolve('scripts/upstream-port-diff.sh');
const ORCA_HEADER = '// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)';

const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function runScript(args: string[], env: Record<string, string>): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [SCRIPT, ...args], { env: { ...process.env, ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** A root with one ported file `src/x.ts` and a records file pointing at it. */
async function fixture(fileText: string | null, commit = 'abc1234'): Promise<Record<string, string>> {
  const root = await tempDir('upstream-ports-');
  if (fileText !== null) {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'x.ts'), fileText);
  }
  const portsFile = join(root, 'ports.json');
  await writeFile(portsFile, JSON.stringify([{ local: 'src/x.ts', upstream: 'orca', path: 'lib/x.ts', commit }]));
  return { UPSTREAM_PORTS_FILE: portsFile, UPSTREAM_PORTS_ROOT: root };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

describe('upstream-port-diff.sh --check', () => {
  it('accepts a record whose file carries the matching header', async () => {
    const env = await fixture(`${ORCA_HEADER}\n// upstream: lib/x.ts @ abc1234\nexport {};\n`);
    const run = await runScript(['--check'], env);
    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toBe('upstream-ports: 1 records OK');
  });

  it.each([
    ['a wrong commit in the header', `${ORCA_HEADER}\n// upstream: lib/x.ts @ fff9999\n`],
    ['a missing header', 'export {};\n'],
    ['a missing file', null],
  ])('rejects %s and names the file', async (_label, text) => {
    const run = await runScript(['--check'], await fixture(text));
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('upstream-ports: src/x.ts:');
  });

  it('rejects a commit that is not hex', async () => {
    const run = await runScript(['--check'], await fixture(`${ORCA_HEADER}\n// upstream: lib/x.ts @ main\n`, 'main'));
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("commit 'main' is not 7-40 lowercase hex");
  });

  it('passes on the real scripts/upstream-ports.json', async () => {
    const run = await runScript(['--check'], {});
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^upstream-ports: \d+ records OK$/m);
  });
});

describe('upstream-port-diff.sh diff mode', () => {
  it('lists upstream commits since the recorded one', async () => {
    const upstream = await tempDir('upstream-repo-');
    await git(upstream, 'init', '-q', '-b', 'main');
    await git(upstream, 'config', 'user.name', 't');
    await git(upstream, 'config', 'user.email', 't@example.com');
    await git(upstream, 'config', 'commit.gpgsign', 'false');
    await mkdir(join(upstream, 'lib'));
    await writeFile(join(upstream, 'lib', 'x.ts'), 'one\n');
    await git(upstream, 'add', '-A');
    await git(upstream, 'commit', '-q', '-m', 'first version');
    const first = await git(upstream, 'rev-parse', 'HEAD');
    await writeFile(join(upstream, 'lib', 'x.ts'), 'two\n');
    await git(upstream, 'commit', '-q', '-am', 'second version of x');
    const second = await git(upstream, 'rev-parse', 'HEAD');

    const behind = await runScript(['orca'], { ...(await fixture('x', first)), ORCA_REPO: upstream, UPSTREAM_REF: 'main' });
    expect(behind.code).toBe(0);
    expect(behind.stdout).toContain('src/x.ts (lib/x.ts):');
    expect(behind.stdout).toContain('second version of x');
    expect(behind.stdout).not.toContain('first version');

    const current = await runScript(['orca'], { ...(await fixture('x', second)), ORCA_REPO: upstream, UPSTREAM_REF: 'main' });
    expect(current.code).toBe(0);
    expect(current.stdout).toContain('src/x.ts: up to date');
  });

  it('skips an upstream whose checkout is missing', async () => {
    const run = await runScript([], { ...(await fixture('x')), ORCA_REPO: '/nonexistent/orca', T3CODE_REPO: '/nonexistent/t3' });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('skip orca: /nonexistent/orca not found');
    expect(run.stdout).toContain('skip t3code: /nonexistent/t3 not found');
  });
});
