import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeVerdict, saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const TOKEN = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
const SESSION = 'wip00000-0000-4000-8000-000000000000';

describe('pan vault save with code snapshots', () => {
  let fx: Fixture;
  let repo: string;
  let transcript: string;

  beforeEach(async () => {
    fx = new Fixture();
    fx.useMachine('a');
    await runCli(() => setupCommand(fx.bareRepo('vault.git'), {}, captureIo()));
    const origin = fx.bareRepo('project.git');
    repo = join(fx.root, 'repo');
    git(fx.root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'pushed');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    transcript = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'user', sessionId: SESSION, cwd: repo, message: { role: 'user', content: 'edit a.txt' } })}\n`,
    );
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('a secret in the snapshot names the file and pattern, never the value, and exits 1', async () => {
    writeFileSync(join(repo, 'secret.ts'), `export const token = '${TOKEN}';\n`);
    const io = captureIo();
    expect(await runCli(() => saveCommand(transcript, {}, io))).toBe(1);
    const out = io.stdout.join('\n');
    expect(out).toMatch(/appended 1 line .*; code snapshot blocked: secret\.ts \(token\) — allow with: pan vault allow-secret [0-9a-f]{8} --file secret\.ts$/);
    expect(out).not.toContain(TOKEN.slice(4, 20));
  }, 30_000);

  it('hook mode with a secret prints nothing and returns', async () => {
    writeFileSync(join(repo, 'secret.ts'), `export const token = '${TOKEN}';\n`);
    const io = captureIo();
    const input = JSON.stringify({ session_id: SESSION, transcript_path: transcript });
    expect(await runCli(() => saveCommand(undefined, { hook: true }, io, { stdin: async () => input }))).toBe(0);
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual([]);
  }, 30_000);

  it('a dirty checkout prints "code snapshot saved"; saving again reports it unchanged', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    const io = captureIo();
    expect(await runCli(() => saveCommand(transcript, {}, io))).toBe(0);
    expect(io.stdout[0]).toMatch(/; code snapshot saved \(\d+(\.\d)? (B|KB)\)$/);
    const again = captureIo();
    expect(await runCli(() => saveCommand(transcript, {}, again))).toBe(0);
    expect(again.stdout[0]).toMatch(/: noop; code unchanged$/);
  }, 30_000);

  it('a clean, pushed checkout reports clean', async () => {
    const io = captureIo();
    expect(await runCli(() => saveCommand(transcript, {}, io))).toBe(0);
    expect(io.stdout[0]).toMatch(/; code clean \(nothing uncommitted or unpushed\)$/);
  }, 30_000);

  it('describes too-large and error skips', () => {
    const base = { verdict: 'noop' as const, vaultId: 'abcdefgh-1' };
    expect(describeVerdict({ ...base, wip: { status: 'skipped', wip: { skipped: 'too-large', bytes: 60 * 1024 * 1024 } } }, 50 * 1024 * 1024))
      .toBe('noop; code snapshot skipped: 60.0 MB exceeds the 50.0 MB cap');
    expect(describeVerdict({ ...base, wip: { status: 'skipped', wip: { skipped: 'error', reason: 'fatal: bad object' } } }))
      .toBe('noop; code snapshot failed: fatal: bad object');
    expect(describeVerdict({ ...base, wip: { status: 'throttled' } })).toBe('noop');
  });
});
