import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveCommand, describeVerdict, resolveTargets } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import type { DiscoveredFile } from '../../../../src/lib/conversations/harness-discovery.js';
import { VAULT_OFF_MESSAGE } from '../../../../src/lib/vault/config.js';
import { listOwned } from '../../../../src/lib/vault/local-index.js';
import { Fixture, captureIo, runCli } from './helpers.js';

const API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

function claudeLine(session: string, text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

describe('pan vault save / sync', () => {
  let fx: Fixture;
  let cwd: string;
  let sessions: Record<string, string>;
  let discovered: DiscoveredFile[];

  beforeEach(async () => {
    fx = new Fixture();
    cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    fx.useMachine('a');
    await runCli(() => setupCommand(fx.bareRepo(), {}, captureIo()));
    sessions = {};
    discovered = [];
    const projectDir = join(fx.root, 'claude-projects', 'repo');
    mkdirSync(projectDir, { recursive: true });
    const days = { old: 3, mid: 1, fresh: 0 } as const;
    for (const [name, ageDays] of Object.entries(days)) {
      const id = `${name}-0000-4000-8000-000000000000`;
      const path = join(projectDir, `${id}.jsonl`);
      writeFileSync(path, `${claudeLine(id, `prompt ${name}`, cwd)}\n`);
      const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
      utimesSync(path, when, when);
      sessions[name] = path;
      discovered.push({ jsonlPath: path, projectDir, harness: 'claude-code' });
    }
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('ac1: --all --since saves exactly the sessions modified on or after the date', async () => {
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const targets = await resolveTargets(undefined, { all: true, since }, async () => discovered);
    expect(targets.map((target) => target.nativePath).sort()).toEqual([sessions.fresh, sessions.mid].sort());

    const io = captureIo();
    expect(await runCli(() => saveCommand(undefined, { all: true, since }, io, { discover: async () => discovered }))).toBe(0);
    expect(io.stdout).toHaveLength(2);
    for (const line of io.stdout) expect(line).toMatch(/: appended 1 line \(vault [0-9a-f]{8}, version 1\)$/);
    expect(Object.keys(await listOwned()).sort()).toEqual([sessions.fresh, sessions.mid].sort());

    const noop = captureIo();
    await runCli(() => saveCommand(undefined, { all: true, since }, noop, { discover: async () => discovered }));
    for (const line of noop.stdout) expect(line).toMatch(/: noop$/);
  });

  it('saves one session by id prefix or by path and filters --harness', async () => {
    const byId = captureIo();
    expect(await runCli(() => saveCommand('old', {}, byId, { discover: async () => discovered }))).toBe(0);
    expect(byId.stdout[0]).toMatch(/^old-0000-4000-8000-000000000000\.jsonl: appended 1 line/);
    const byPath = captureIo();
    expect(await runCli(() => saveCommand(sessions.mid!, {}, byPath))).toBe(0);
    expect(byPath.stdout[0]).toMatch(/appended 1 line/);
    const none = captureIo();
    expect(await runCli(() => saveCommand('nope', {}, none, { discover: async () => discovered }))).toBe(0);
    expect(none.stdout).toEqual(['No transcript matches nope.']);
    const noFlag = captureIo();
    expect(await runCli(() => saveCommand(undefined, {}, noFlag))).toBe(1);
    expect(noFlag.stderr[0]).toContain('--all');
    expect(await resolveTargets(undefined, { all: true, harness: 'codex' }, async () => discovered)).toEqual([]);
  });

  it('ac2: with the vault off, --hook prints nothing and exits 0; with it on, --hook settles silently', async () => {
    const hookInput = JSON.stringify({ session_id: 'fresh-0000-4000-8000-000000000000', transcript_path: sessions.fresh });
    fx.useMachine('off');
    const off = captureIo();
    expect(await runCli(() => saveCommand(undefined, { hook: true }, off, { stdin: async () => hookInput }))).toBe(0);
    expect(off.stdout).toEqual([]);
    expect(off.stderr).toEqual([]);

    fx.useMachine('a');
    const on = captureIo();
    expect(await runCli(() => saveCommand(undefined, { hook: true }, on, { stdin: async () => hookInput }))).toBe(0);
    expect(on.stdout).toEqual([]);
    expect(Object.keys(await listOwned())).toEqual([sessions.fresh]);

    const garbage = captureIo();
    expect(await runCli(() => saveCommand(undefined, { hook: true }, garbage, { stdin: async () => 'not json' }))).toBe(0);
    expect(garbage.stdout).toEqual([]);
    expect(garbage.stderr).toEqual([]);
  });

  it('ac3: a session with a secret prints "blocked at line N: <pattern>" and exits non-zero', async () => {
    const id = 'secret-0000-4000-8000-000000000000';
    const path = join(fx.root, `${id}.jsonl`);
    writeFileSync(path, `${claudeLine(id, 'hello', cwd)}\n${claudeLine(id, `key ${API_KEY}`, cwd)}\n`);
    const io = captureIo();
    expect(await runCli(() => saveCommand(path, {}, io))).toBe(1);
    expect(io.stdout[0]).toBe(`${id}.jsonl: blocked at line 2: api-key`);
    expect(io.stdout.join('\n')).not.toContain(API_KEY.slice(0, 12));
    expect(await listOwned()).toEqual({});
  });

  it('describeVerdict covers every verdict', () => {
    expect(describeVerdict({ verdict: 'noop', vaultId: 'v' })).toBe('noop');
    expect(describeVerdict({ verdict: 'excluded', vaultId: null })).toBe('excluded');
    expect(describeVerdict({ verdict: 'offline', vaultId: null })).toBe('offline');
    expect(describeVerdict({ verdict: 'diverged', vaultId: 'v', reason: 'line 3 differs' })).toBe('diverged: line 3 differs');
    expect(describeVerdict({ verdict: 'append', vaultId: 'abcdefgh-1', chunks: ['c'], lines: 2, version: 3, forkedFrom: { vaultId: 'parent00-x', version: 2 } }))
      .toBe('appended 2 lines (vault abcdefgh, version 3); forked from parent00@2');
  });

  it('sync prints counts, and the vault-off message when off', async () => {
    await runCli(() => saveCommand(sessions.old!, {}, captureIo()));
    const io = captureIo();
    expect(await runCli(() => syncCommand({}, io))).toBe(0);
    expect(io.stdout[0]).toMatch(/^Settled 0 transcripts; 1 record listed; 1 machine\.$/);
    fx.useMachine('off');
    const off = captureIo();
    expect(await runCli(() => syncCommand({}, off))).toBe(0);
    expect(off.stdout).toEqual([VAULT_OFF_MESSAGE]);
  });
});
