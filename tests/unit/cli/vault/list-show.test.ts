import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listCommand } from '../../../../src/cli/commands/vault/list.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { showCommand } from '../../../../src/cli/commands/vault/show.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { readEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const SESSION = 'ls000000-0000-4000-8000-000000000000';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}
function assistant(text: string, cwd: string): string {
  return JSON.stringify({ type: 'assistant', sessionId: SESSION, cwd, message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

describe('pan vault list / show', () => {
  let fx: Fixture;
  let remote: string;
  let cwd: string;
  let nativePath: string;
  let phrase: string;

  beforeEach(async () => {
    fx = new Fixture();
    remote = fx.bareRepo();
    cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    fx.useMachine('a');
    const setupIo = captureIo();
    await runCli(() => setupCommand(remote, {}, setupIo));
    phrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
    nativePath = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, `${user('the listed title', cwd)}\n${assistant('first reply', cwd)}\n`);
    await runCli(() => saveCommand(nativePath, {}, captureIo()));
    appendFileSync(nativePath, `${user('second prompt', cwd)}\n`);
    await runCli(() => saveCommand(nativePath, {}, captureIo()));
    appendFileSync(nativePath, `${assistant('second reply', cwd)}\n${user('third', cwd)}\n`);
    await runCli(() => saveCommand(nativePath, {}, captureIo()));
    await runCli(() => syncCommand({}, captureIo()));
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('ac1: on machine B, list shows the title with owner A and without "(this machine)"', async () => {
    const a = (await readEnvironmentIdentity())!;
    fx.useMachine('b');
    const phraseFile = join(fx.root, 'phrase.txt');
    writeFileSync(phraseFile, phrase);
    await runCli(() => joinCommand(remote, { phraseFile }, captureIo()));
    const io = captureIo();
    expect(await runCli(() => listCommand({}, io))).toBe(0);
    const row = io.stdout.find((line) => line.includes('the listed title'))!;
    expect(row).toBeDefined();
    expect(row).toContain(a.label);
    expect(row).not.toContain('(this machine)');
    expect(row).toContain('claude-code');

    fx.useMachine('a');
    const mine = captureIo();
    await runCli(() => listCommand({}, mine));
    expect(mine.stdout.find((line) => line.includes('the listed title'))).toContain('(this machine)');
    const json = captureIo();
    await runCli(() => listCommand({ json: true }, json));
    expect(JSON.parse(json.stdout.join('\n'))).toEqual([expect.objectContaining({ title: 'the listed title', ownerIsHere: true })]);
  });

  it('ac2: show prints the conversation text and versions 1..3', async () => {
    const list = captureIo();
    await runCli(() => listCommand({ json: true }, list));
    const vaultId = (JSON.parse(list.stdout.join('\n')) as Array<{ vaultId: string }>)[0]!.vaultId;
    const io = captureIo();
    expect(await runCli(() => showCommand(vaultId.slice(0, 8), {}, io))).toBe(0);
    const text = io.stdout.join('\n');
    expect(text).toContain('the listed title');
    expect(text).toContain('Human: the listed title');
    expect(text).toContain('Assistant: first reply');
    expect(text).toContain('Human: third');
    expect(text).toMatch(/v1 .*turn 1 .*2 lines/);
    expect(text).toMatch(/v2 .*turn 2 .*3 lines/);
    expect(text).toMatch(/v3 .*turn 3 .*5 lines/);
    const missing = captureIo();
    expect(await runCli(() => showCommand('zzzzzzzz', {}, missing))).toBe(1);
  });

  it('ac3: with the backend unreachable, list still prints the cached rows and exits 0', async () => {
    const cloneDir = join(process.env.OVERDECK_HOME!, 'vault', 'git');
    git(cloneDir, 'remote', 'set-url', 'origin', join(fx.root, 'gone', 'nope.git'));
    const io = captureIo();
    expect(await runCli(() => listCommand({}, io))).toBe(0);
    expect(io.stdout.some((line) => line.includes('the listed title'))).toBe(true);
    const sync = captureIo();
    expect(await runCli(() => syncCommand({}, sync))).toBe(1);
    expect(sync.stderr[0]).toContain('unreachable');
  });
});
