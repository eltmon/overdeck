/**
 * PAN-4264 Work Item 13: the launcher writes a count-only `gh` shim beside the
 * git guard. Running it appends one ledger line (caller agent, outcome
 * unknown) and passes the real gh's stdout and exit code through.
 */

import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildConversationGhShimLines, buildGitGuardLines } from '../launcher-git-guard.js';

const execFileAsync = promisify(execFile);

let home: string;
let fakeBin: string;
let ghShim: string;
let previousHome: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'gh-shim-'));
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;

  // A fake "real gh" that echoes its args and exits 3.
  fakeBin = join(home, 'fake-bin');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'gh'), '#!/bin/sh\necho "real-gh $*"\nexit 3\n');
  chmodSync(join(fakeBin, 'gh'), 0o755);

  const repo = join(home, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('bash', ['-ec', buildGitGuardLines('agent-pan-4264', repo).join('\n')], {
    cwd: home,
    stdio: 'ignore',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
  });
  ghShim = join(home, 'agents', 'agent-pan-4264', 'git-guard', 'gh');
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function ledgerLines(): Array<Record<string, unknown>> {
  const dir = join(home, 'github-quota');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^ledger-\d{10}\.jsonl$/.test(name))
    .flatMap((name) => readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('agent gh shim (PAN-4264)', () => {
  it('is emitted beside the git guard', () => {
    const lines = buildGitGuardLines('agent-pan-4264', join(home, 'repo'));
    expect(lines.some((line) => line.includes("/git-guard/gh' <<EOF"))).toBe(true);
    expect(lines.findIndex((line) => line.startsWith('_OVERDECK_REAL_GH=')))
      .toBeGreaterThan(lines.findIndex((line) => line.startsWith('PATH=')));
    expect(existsSync(ghShim)).toBe(true);
  });

  it('appends one ledger line and passes through stdout and the exit code', async () => {
    const before = ledgerLines().length;
    const error = await execFileAsync('sh', [ghShim, 'pr', 'view', '12'], { encoding: 'utf8' })
      .then(() => null, (e: { code?: number; stdout?: string }) => e);

    expect(error?.code).toBe(3);
    expect(error?.stdout).toBe('real-gh pr view 12\n');

    const lines = ledgerLines();
    expect(lines).toHaveLength(before + 1);
    const line = lines.at(-1)!;
    expect(line).toMatchObject({
      kind: 'call', caller: 'agent', agent: 'agent-pan-4264', pool: 'user', bucket: 'graphql',
      cost: 1, estimated: true, outcome: 'unknown',
    });
    expect(Number.isFinite(Date.parse(String(line.ts)))).toBe(true);
    expect(typeof line.pid).toBe('number');
  });

  it('classifies gh api <path> and gh run as REST, gh api graphql as GraphQL', async () => {
    const before = ledgerLines().length;
    for (const args of [['api', 'repos/o/r'], ['run', 'list'], ['api', 'graphql', '-f', 'query=q']]) {
      await execFileAsync('sh', [ghShim, ...args]).catch(() => undefined);
    }
    expect(ledgerLines().slice(before).map((line) => line.bucket)).toEqual(['rest', 'rest', 'graphql']);
  });

  it('does not count a call runGh already metered (OVERDECK_GH_METERED=1)', async () => {
    const before = ledgerLines().length;
    const error = await execFileAsync('sh', [ghShim, 'pr', 'list'], {
      encoding: 'utf8',
      env: { ...process.env, OVERDECK_GH_METERED: '1' },
    }).then(() => null, (e: { code?: number; stdout?: string }) => e);
    expect(error?.stdout).toBe('real-gh pr list\n');
    expect(ledgerLines()).toHaveLength(before);
  });

  it('writes to the launch-time ledger directory even when OVERDECK_HOME changes at call time', async () => {
    const before = ledgerLines().length;
    const elsewhere = join(home, 'polluted-home');
    await execFileAsync('sh', [ghShim, 'api', 'repos/o/r'], {
      env: { ...process.env, OVERDECK_HOME: elsewhere },
    }).catch(() => undefined);
    expect(ledgerLines()).toHaveLength(before + 1);
    expect(ledgerLines().at(-1)).toMatchObject({ caller: 'agent', bucket: 'rest' });
    expect(existsSync(join(elsewhere, 'github-quota'))).toBe(false);
  });
});

describe('grant-label deny (PAN-4343)', () => {
  async function runShim(args: string[], env: NodeJS.ProcessEnv = process.env) {
    return execFileAsync('sh', [ghShim, ...args], { encoding: 'utf8', env })
      .then(
        ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
        (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
      );
  }

  it.each([
    [['issue', 'edit', '1', '--add-label', 'released']],
    [['issue', 'edit', '1', '--add-label=Released']],
    [['issue', 'edit', '1', '--add-label', 'bug, auto-merge']],
    [['issue', 'edit', '1', '--remove-label', 'hold-for-uat']],
    [['pr', 'edit', '5', '--add-label', 'auto-merge']],
    [['issue', 'create', '--title', 't', '-l', 'released']],
    [['pr', 'create', '-lhold-for-uat']],
    [['api', 'repos/o/r/issues/1/labels', '-f', 'labels[]=released']],
    [['api', '-X', 'DELETE', 'repos/o/r/issues/1/labels/hold-for-uat']],
    [['api', '--method=post', 'repos/o/r/issues/1/labels', '-f', 'labels[]=AUTO-MERGE']],
    [['api', 'repos/o/r/issues', '-f', 'title=t', '-f', 'labels[]=released']],
    [['api', '-X', 'PATCH', 'repos/o/r/issues/1', '-F', 'labels[]=hold-for-uat']],
  ])('refuses gh %j without running gh or counting it', async (args) => {
    const before = ledgerLines().length;
    const result = await runShim(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('operator grant label');
    expect(ledgerLines()).toHaveLength(before);
  });

  it.each([
    [['issue', 'edit', '1', '--add-label', 'bug']],
    [['issue', 'edit', '1', '--title', 'released']],
    [['api', 'repos/o/r/issues/1/labels']],
    [['api', 'repos/o/r/issues/1/comments', '-f', 'body=released']],
    [['api', 'repos/o/r/issues?labels=released']],
    [['api', 'graphql', '-f', 'query=released']],
  ])('passes gh %j through and counts it', async (args) => {
    const before = ledgerLines().length;
    const result = await runShim(args);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe(`real-gh ${args.join(' ')}\n`);
    expect(ledgerLines()).toHaveLength(before + 1);
  });

  it('refuses even when OVERDECK_GH_METERED=1', async () => {
    const result = await runShim(['issue', 'edit', '1', '--add-label', 'released'], { ...process.env, OVERDECK_GH_METERED: '1' });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('operator grant label');
  });
});

describe('conversation gh shim (PAN-4343)', () => {
  function install(conversationId: string, deny: boolean, path = `${fakeBin}:${process.env.PATH ?? ''}`): string {
    execFileSync('bash', ['-ec', buildConversationGhShimLines(conversationId, deny).join('\n')], {
      cwd: home,
      stdio: 'ignore',
      env: { ...process.env, PATH: path },
    });
    return join(home, 'conversations', conversationId, 'git-guard');
  }

  async function run(shim: string, args: string[]) {
    return execFileAsync('sh', [shim, ...args], { encoding: 'utf8' })
      .then(
        ({ stdout }) => ({ code: 0, stdout }),
        (e: { code?: number; stdout?: string }) => ({ code: e.code, stdout: e.stdout }),
      );
  }

  it('writes only a gh shim in the conversation guard dir', () => {
    const guardDir = install('conv-42', false);
    expect(existsSync(join(guardDir, 'gh'))).toBe(true);
    expect(existsSync(join(guardDir, 'git'))).toBe(false);
  });

  it('passes grant-label writes through for an operator conversation and counts them', async () => {
    const shim = join(install('conv-42', false), 'gh');
    for (const label of ['released', 'bug']) {
      const result = await run(shim, ['issue', 'edit', '1', '--add-label', label]);
      expect(result.code).toBe(3);
      expect(result.stdout).toBe(`real-gh issue edit 1 --add-label ${label}\n`);
    }
    expect(ledgerLines().at(-1)).toMatchObject({ caller: 'agent', agent: 'conv-42' });
  });

  it('refuses grant-label writes for the Flywheel conversation', async () => {
    const shim = join(install('conv-flywheel', true), 'gh');
    expect((await run(shim, ['issue', 'edit', '1', '--add-label', 'released'])).code).toBe(1);
    expect(await run(shim, ['issue', 'edit', '1', '--add-label', 'bug']))
      .toEqual({ code: 3, stdout: 'real-gh issue edit 1 --add-label bug\n' });
  });

  it('bakes the real gh, not an inherited guard dir shim', () => {
    const inherited = join(home, 'inherited', 'git-guard');
    mkdirSync(inherited, { recursive: true });
    writeFileSync(join(inherited, 'gh'), '#!/bin/sh\necho "inherited-shim $*"\n');
    chmodSync(join(inherited, 'gh'), 0o755);

    const shim = readFileSync(join(install('conv-inherit', false, `${inherited}:${fakeBin}:${process.env.PATH ?? ''}`), 'gh'), 'utf8');
    expect(shim).toContain(`_OVERDECK_REAL_GH="${join(fakeBin, 'gh')}"`);
    expect(shim).not.toContain(inherited);
  });
});
