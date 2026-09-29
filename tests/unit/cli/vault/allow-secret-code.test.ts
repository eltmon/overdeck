import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowSecretCommand } from '../../../../src/cli/commands/vault/allow-secret.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { listOwned } from '../../../../src/lib/vault/local-index.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const TOKEN = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
const SESSION = 'allow000-0000-4000-8000-000000000000';

describe('pan vault allow-secret --file', () => {
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
      `${JSON.stringify({ type: 'user', sessionId: SESSION, cwd: repo, message: { role: 'user', content: 'add config' } })}\n`,
    );
    writeFileSync(join(repo, 'config.ts'), `export const token = '${TOKEN}';\nexport const other = 1;\n`);
  });

  afterEach(() => {
    fx.cleanup();
  });

  async function vaultId(): Promise<string> {
    return Object.values(await listOwned())[0]!.vaultId;
  }

  it('allows the blocked lines of a file so the next save captures the snapshot', async () => {
    const blocked = captureIo();
    expect(await runCli(() => saveCommand(transcript, {}, blocked))).toBe(1);
    expect(blocked.stdout[0]).toContain('code snapshot blocked: config.ts (token)');

    const id = (await vaultId()).slice(0, 8);
    const allow = captureIo();
    expect(await runCli(() => allowSecretCommand(id, undefined, { file: 'config.ts' }, allow))).toBe(0);
    expect(allow.stdout).toEqual([
      `Allowed 1 line(s) of config.ts for record ${id}. Run pan vault save to retry the code snapshot.`,
    ]);
    expect(allow.stdout.join('\n')).not.toContain(TOKEN.slice(4, 20));

    const retried = captureIo();
    expect(await runCli(() => saveCommand(transcript, {}, retried))).toBe(0);
    expect(retried.stdout[0]).toMatch(/: noop; code snapshot saved \(/);
  }, 30_000);

  it('requires exactly one of a line number or --file', async () => {
    const neither = captureIo();
    expect(await runCli(() => allowSecretCommand('x', undefined, {}, neither))).toBe(1);
    expect(neither.stderr).toEqual(['Give a line number or --file <path>.']);
    const both = captureIo();
    expect(await runCli(() => allowSecretCommand('x', '2', { file: 'config.ts' }, both))).toBe(1);
    expect(both.stderr).toEqual(['Give a line number or --file <path>.']);
  });

  it('refuses a file with no blocked lines', async () => {
    await runCli(() => saveCommand(transcript, {}, captureIo()));
    const id = await vaultId();
    const io = captureIo();
    expect(await runCli(() => allowSecretCommand(id, undefined, { file: 'a.txt' }, io))).toBe(1);
    expect(io.stderr).toEqual(['No blocked lines in a.txt.']);
  }, 30_000);
});
