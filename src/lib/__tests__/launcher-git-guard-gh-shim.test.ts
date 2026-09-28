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

import { buildGitGuardLines } from '../launcher-git-guard.js';

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
