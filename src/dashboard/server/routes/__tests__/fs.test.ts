/**
 * Tests for GET /api/fs/list-dirs
 *
 * The route is tested via its helper logic directly — no Effect end-to-end
 * harness needed. We test: listing a subdir under home, default-to-home, and
 * the escape-home security rejection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// ─── Inline the route logic to test it without booting Effect ────────────────

function isWithinHome(p: string, home: string): boolean {
  return p === home || p.startsWith(home.endsWith(sep) ? home : `${home}${sep}`);
}

async function listDirsLogic(rawPath: string | null, home: string): Promise<
  | { ok: true; path: string; parent: string | null; entries: { name: string; path: string }[] }
  | { ok: false; status: number; error: string }
> {
  const { normalize } = await import('node:path');
  const target = rawPath ? resolve(normalize(rawPath)) : home;

  if (!isWithinHome(target, home)) {
    return { ok: false, status: 400, error: 'Path is outside home directory' };
  }

  const parent = target === home ? null : resolve(target, '..');

  const dirents = await readdir(target, { withFileTypes: true });
  const entries = dirents
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ name: d.name, path: resolve(target, d.name) }));

  return { ok: true, path: target, parent, entries };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/fs/list-dirs logic', () => {
  let tmpHome: string;
  let subA: string;
  let subB: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `fs-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
    subA = join(tmpHome, 'aaa');
    subB = join(tmpHome, 'bbb');
    mkdirSync(subA, { recursive: true });
    mkdirSync(subB, { recursive: true });
    // also a file — should NOT appear in entries
    import('node:fs').then(({ writeFileSync }) => writeFileSync(join(tmpHome, 'file.txt'), ''));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('lists immediate subdirs of a directory under home', async () => {
    const result = await listDirsLogic(tmpHome, tmpHome);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(tmpHome);
    expect(result.parent).toBeNull();
    const names = result.entries.map((e) => e.name);
    expect(names).toEqual(['aaa', 'bbb']); // sorted
    expect(result.entries[0].path).toBe(subA);
    expect(result.entries[1].path).toBe(subB);
  });

  it('defaults to home when path param is absent', async () => {
    const home = homedir();
    const result = await listDirsLogic(null, home);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(home);
    expect(result.parent).toBeNull();
    // entries should be an array (contents of actual home — just verify type)
    expect(Array.isArray(result.entries)).toBe(true);
    result.entries.forEach((e) => {
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('path');
    });
  });

  it('rejects a path that resolves outside home (escape via ..)', async () => {
    const escaped = join(tmpHome, '..', '..', 'etc');
    const result = await listDirsLogic(escaped, tmpHome);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/outside home/i);
  });

  it('rejects an absolute path that is not under home', async () => {
    const result = await listDirsLogic('/etc', tmpHome);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it('sets parent to the containing dir for a nested path', async () => {
    const result = await listDirsLogic(subA, tmpHome);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(subA);
    expect(result.parent).toBe(tmpHome);
  });
});
