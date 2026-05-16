/**
 * Tests for safe-settings.ts — PAN-1137 regression suite.
 *
 * The pre-PAN-1137 installer had a parse-failure path that silently
 * reset ~/.claude/settings.json to `{}` and wrote the result back,
 * erasing every user customization. These tests pin the new behavior:
 *
 *   1. Parse failures abort (process.exit(1)) and leave the file alone.
 *   2. Round-trip preserves unknown top-level keys.
 *   3. Backups are created before every write, bounded to 5.
 *   4. Writes are atomic — the tmpfile is renamed onto the target.
 *   5. The dry-run diff renders added/removed/changed keys.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import {
  readSettingsOrAbortSync,
  backupSettingsSync,
  pruneBackupsSync,
  atomicWriteJsonSync,
  diffJson,
  SETTINGS_BACKUP_KEEP,
} from '../../../src/cli/commands/setup/safe-settings.js';

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pan-1137-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('readSettingsOrAbortSync', () => {
  let h: ReturnType<typeof makeTempDir>;
  beforeEach(() => { h = makeTempDir(); });
  afterEach(() => h.cleanup());

  it('returns parsed object for a valid settings.json', () => {
    const path = join(h.dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark', statusLine: { type: 'command' } }), 'utf-8');
    const result = readSettingsOrAbortSync(path);
    expect(result).toEqual({ theme: 'dark', statusLine: { type: 'command' } });
  });

  it('returns empty object when the file does not exist (fresh install)', () => {
    const path = join(h.dir, 'settings.json');
    expect(readSettingsOrAbortSync(path)).toEqual({});
  });

  it('PAN-1137: aborts with non-zero exit on parse failure rather than resetting to {}', () => {
    const path = join(h.dir, 'settings.json');
    writeFileSync(path, '{ "hooks": {', 'utf-8'); // truncated, unparseable
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('__process_exit_called__');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => readSettingsOrAbortSync(path)).toThrow('__process_exit_called__');
    expect(exitSpy).toHaveBeenCalledWith(1);

    // Critical: the corrupt file was NOT overwritten or truncated by the
    // failed read attempt. This is the regression we're guarding against.
    expect(readFileSync(path, 'utf-8')).toBe('{ "hooks": {');

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('PAN-1137: error message points at the file and any existing backup', () => {
    const path = join(h.dir, 'settings.json');
    writeFileSync(path, '{ "hooks": {', 'utf-8');
    const backupPath = `${path}.pan-backup-2026-05-15T12-00-00-000Z`;
    writeFileSync(backupPath, JSON.stringify({ theme: 'dark' }), 'utf-8');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('__exit__');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => readSettingsOrAbortSync(path)).toThrow('__exit__');
    const calls = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(calls).toContain('not valid JSON');
    expect(calls).toContain(backupPath);

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('backupSettingsSync + pruneBackupsSync', () => {
  let h: ReturnType<typeof makeTempDir>;
  beforeEach(() => { h = makeTempDir(); });
  afterEach(() => h.cleanup());

  it('creates a timestamped backup adjacent to the original', () => {
    const path = join(h.dir, 'settings.json');
    const original = JSON.stringify({ theme: 'dark' });
    writeFileSync(path, original, 'utf-8');
    const backupPath = backupSettingsSync(path);
    expect(backupPath).toBeTruthy();
    expect(backupPath!.startsWith(`${path}.pan-backup-`)).toBe(true);
    expect(readFileSync(backupPath!, 'utf-8')).toBe(original);
  });

  it('returns null when the file does not exist', () => {
    expect(backupSettingsSync(join(h.dir, 'missing.json'))).toBeNull();
  });

  it(`prunes to ${SETTINGS_BACKUP_KEEP} most recent backups`, () => {
    const path = join(h.dir, 'settings.json');
    writeFileSync(path, '{}', 'utf-8');
    // Create 10 backups with sortable timestamps. We make them by hand
    // (rather than calling backupSettingsSync 10 times) so the timestamps
    // are deterministic and we don't race the per-millisecond resolution.
    for (let i = 0; i < 10; i++) {
      const ts = `2026-05-${String(15 + i).padStart(2, '0')}T00-00-00-000Z`;
      writeFileSync(`${path}.pan-backup-${ts}`, '{}', 'utf-8');
    }
    pruneBackupsSync(path);
    const remaining = readdirSync(h.dir).filter((f) => f.startsWith(`${basename(path)}.pan-backup-`));
    expect(remaining.length).toBe(SETTINGS_BACKUP_KEEP);
    // Sort descending — the kept ones must be the newest dates (24th-20th).
    remaining.sort().reverse();
    expect(remaining[0]).toContain('2026-05-24');
    expect(remaining[4]).toContain('2026-05-20');
  });

  it('keeps all backups when fewer than the limit exist', () => {
    const path = join(h.dir, 'settings.json');
    writeFileSync(path, '{}', 'utf-8');
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-${String(15 + i).padStart(2, '0')}T00-00-00-000Z`;
      writeFileSync(`${path}.pan-backup-${ts}`, '{}', 'utf-8');
    }
    pruneBackupsSync(path);
    const remaining = readdirSync(h.dir).filter((f) => f.startsWith(`${basename(path)}.pan-backup-`));
    expect(remaining.length).toBe(3);
  });
});

describe('atomicWriteJsonSync', () => {
  let h: ReturnType<typeof makeTempDir>;
  beforeEach(() => { h = makeTempDir(); });
  afterEach(() => h.cleanup());

  it('writes JSON content with trailing newline', () => {
    const path = join(h.dir, 'settings.json');
    atomicWriteJsonSync(path, { theme: 'dark' });
    expect(readFileSync(path, 'utf-8')).toBe(`${JSON.stringify({ theme: 'dark' }, null, 2)}\n`);
  });

  it('leaves no .tmp file behind after a successful write', () => {
    const path = join(h.dir, 'settings.json');
    atomicWriteJsonSync(path, { x: 1 });
    const stragglers = readdirSync(h.dir).filter((f) => f.startsWith('settings.json.tmp-'));
    expect(stragglers).toEqual([]);
  });

  it('creates the parent directory if missing', () => {
    const path = join(h.dir, 'nested', 'sub', 'settings.json');
    atomicWriteJsonSync(path, { ok: true });
    expect(existsSync(path)).toBe(true);
  });
});

describe('PAN-1137 round-trip: unknown top-level keys survive', () => {
  let h: ReturnType<typeof makeTempDir>;
  beforeEach(() => { h = makeTempDir(); });
  afterEach(() => h.cleanup());

  it('preserves statusLine, theme, mcpServers, and other custom keys', () => {
    const path = join(h.dir, 'settings.json');
    const original = {
      statusLine: { type: 'command', command: '/home/eltmon/.claude/statusline.sh', padding: 0 },
      theme: 'dark',
      effortLevel: 'medium',
      advisorModel: 'opus',
      voiceEnabled: true,
      mcpServers: { someServer: { command: 'foo' } },
      hooks: { SessionStart: [{ matcher: '.*', hooks: [] }] },
      skipDangerousModePermissionPrompt: true,
    };
    writeFileSync(path, JSON.stringify(original, null, 2), 'utf-8');

    // Simulate the installer mutation: read, touch a hook, atomic-write.
    const settings = readSettingsOrAbortSync(path);
    if (!settings['hooks']) settings['hooks'] = {};
    settings['hooks'].SessionStart = [
      { matcher: '.*', hooks: [{ type: 'command', command: '/home/eltmon/.panopticon/bin/session-start-hook' }] },
    ];
    backupSettingsSync(path);
    atomicWriteJsonSync(path, settings);
    pruneBackupsSync(path);

    const after = JSON.parse(readFileSync(path, 'utf-8'));
    expect(after.statusLine).toEqual(original.statusLine);
    expect(after.theme).toBe('dark');
    expect(after.effortLevel).toBe('medium');
    expect(after.advisorModel).toBe('opus');
    expect(after.voiceEnabled).toBe(true);
    expect(after.mcpServers).toEqual(original.mcpServers);
    expect(after.skipDangerousModePermissionPrompt).toBe(true);
    // The mutation we intended actually landed.
    expect(after.hooks.SessionStart[0].hooks[0].command).toBe('/home/eltmon/.panopticon/bin/session-start-hook');

    // A backup was created.
    const backups = readdirSync(h.dir).filter((f) => f.startsWith(`${basename(path)}.pan-backup-`));
    expect(backups.length).toBe(1);
  });
});

describe('diffJson', () => {
  it('shows added keys with a + prefix', () => {
    const out = diffJson({ a: 1 }, { a: 1, b: 2 });
    expect(out).toContain('+ b');
  });

  it('shows removed keys with a - prefix', () => {
    const out = diffJson({ a: 1, b: 2 }, { a: 1 });
    expect(out).toContain('- b');
  });

  it('shows changed keys with a ~ prefix', () => {
    const out = diffJson({ a: 1 }, { a: 2 });
    expect(out).toContain('~ a');
  });

  it('returns a "no changes" marker when objects match', () => {
    const out = diffJson({ a: 1 }, { a: 1 });
    expect(out).toContain('no changes');
  });
});
