import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evictCommand } from '../../../../src/cli/commands/vault/evict.js';
import { restoreCommand } from '../../../../src/cli/commands/vault/restore.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { writeVaultConfig } from '../../../../src/lib/vault/config.js';
import { readEvictionBatch } from '../../../../src/lib/vault/evict.js';
import { listOwned } from '../../../../src/lib/vault/local-index.js';
import { Fixture, captureIo, runCli } from './helpers.js';

const HOUR = 60 * 60 * 1000;

function user(session: string, text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

describe('pan vault evict / restore', () => {
  let fx: Fixture;
  let cwd: string;
  let paths: string[];

  beforeEach(async () => {
    fx = new Fixture();
    fx.useMachine('a');
    await runCli(() => setupCommand(fx.bareRepo(), {}, captureIo()));
    await writeVaultConfig({ evict: true });
    cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    paths = [];
    for (const name of ['ev100000', 'ev200000']) {
      const session = `${name}-0000-4000-8000-000000000000`;
      const path = join(fx.root, `${session}.jsonl`);
      writeFileSync(path, `${user(session, `conversation ${name}`, cwd)}\n${user(session, 'more', cwd)}\n`);
      await runCli(() => saveCommand(path, {}, captureIo()));
      ageFile(path, HOUR);
      paths.push(path);
    }
    await runCli(() => syncCommand({}, captureIo()));
  });

  afterEach(() => {
    fx.cleanup();
  });

  function fingerprintFrom(io: { stdout: string[] }): string {
    return io.stdout.find((line) => line.startsWith('Fingerprint: '))!.slice('Fingerprint: '.length);
  }

  it('ac1: review prints each path, size, status, the total and a fingerprint; every file still exists', async () => {
    const io = captureIo();
    expect(await runCli(() => evictCommand({}, io))).toBe(0);
    const text = io.stdout.join('\n');
    for (const path of paths) {
      expect(text).toContain(path);
      expect(existsSync(path)).toBe(true);
    }
    expect(text).toMatch(/verified/);
    expect(text).toMatch(/Total: 2 files, [\d.]+ (B|KB)/);
    expect(fingerprintFrom(io)).toMatch(/^[0-9a-f]{64}$/);
    expect(text).toContain('nothing is deleted until you confirm');
  });

  it('ac2: --confirm <fingerprint> deletes exactly the verified files and prints bytes freed', async () => {
    const review = captureIo();
    await runCli(() => evictCommand({}, review));
    const fingerprint = fingerprintFrom(review);
    const sizes = paths.map((path) => readFileSync(path).length);

    const stale = captureIo();
    expect(await runCli(() => evictCommand({ confirm: 'not-the-fingerprint' }, stale))).toBe(1);
    expect(stale.stderr[0]).toContain(fingerprint);
    for (const path of paths) expect(existsSync(path)).toBe(true);

    const confirm = captureIo();
    expect(await runCli(() => evictCommand({ confirm: fingerprint }, confirm))).toBe(0);
    for (const path of paths) expect(existsSync(path)).toBe(false);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    expect(confirm.stdout.at(-1)).toContain(`Deleted 2 files, freed ${total} B`);
    expect((await readEvictionBatch()).entries).toEqual([]);
  });

  it('ac3: restore rebuilds an evicted transcript byte for byte at its original path', async () => {
    const original = readFileSync(paths[0]!);
    const review = captureIo();
    await runCli(() => evictCommand({}, review));
    await runCli(() => evictCommand({ confirm: fingerprintFrom(review) }, captureIo()));
    expect(existsSync(paths[0]!)).toBe(false);
    const vaultId = Object.entries(await listOwned()).find(([path]) => path === paths[0])![1].vaultId;

    const io = captureIo();
    expect(await runCli(() => restoreCommand(vaultId.slice(0, 8), {}, io))).toBe(0);
    expect(io.stdout[0]).toBe(`Restored 2 lines to ${paths[0]}`);
    expect(readFileSync(paths[0]!).equals(original)).toBe(true);
    const again = captureIo();
    expect(await runCli(() => restoreCommand(vaultId, {}, again))).toBe(1);
    expect(again.stderr[0]).toMatch(/Refusing to overwrite/);
    const elsewhere = join(fx.root, 'copy.jsonl');
    expect(await runCli(() => restoreCommand(vaultId, { to: elsewhere }, captureIo()))).toBe(0);
    expect(readFileSync(elsewhere).equals(original)).toBe(true);
  });

  it('ac4: --clear deletes nothing; --decline and --reoffer manage the batch', async () => {
    await runCli(() => evictCommand({}, captureIo()));
    expect((await readEvictionBatch()).entries).toHaveLength(2);
    const clear = captureIo();
    expect(await runCli(() => evictCommand({ clear: true }, clear))).toBe(0);
    expect((await readEvictionBatch()).entries).toEqual([]);
    for (const path of paths) expect(existsSync(path)).toBe(true);

    const review = captureIo();
    await runCli(() => evictCommand({}, review));
    const vaultId = Object.values(await listOwned())[0]!.vaultId;
    await runCli(() => evictCommand({ decline: vaultId }, captureIo()));
    expect((await readEvictionBatch()).entries).toHaveLength(1);
    expect((await readEvictionBatch()).declined).toHaveLength(1);
    const afterDecline = captureIo();
    await runCli(() => evictCommand({}, afterDecline));
    expect((await readEvictionBatch()).entries).toHaveLength(1);
    await runCli(() => evictCommand({ reoffer: vaultId }, captureIo()));
    expect((await readEvictionBatch()).entries).toHaveLength(2);
    for (const path of paths) expect(existsSync(path)).toBe(true);
  });
});
