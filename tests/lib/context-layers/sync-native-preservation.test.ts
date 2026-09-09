import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ home: '/tmp', projects: [] as Array<{ key: string; config: { path: string; name: string } }> }));
vi.mock('os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => fixture.home }));
vi.mock('../../../src/lib/projects.js', () => ({ listProjectsSync: () => fixture.projects }));

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function snapshot(path: string): unknown {
  const stat = lstatSync(path);
  const info = { mode: stat.mode, inode: stat.ino, modified: stat.mtimeMs };
  if (stat.isSymbolicLink()) return { ...info, target: readlinkSync(path) };
  if (stat.isDirectory()) return Object.fromEntries(readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]));
  return { ...info, bytes: readFileSync(path).toString('base64') };
}

describe('sync native instruction no-loss audit', () => {
  it('preserves absent, marked, malformed, symlinked, read-only, and nested native files across repeated syncs', async () => {
    vi.resetModules();
    const root = mkdtempSync(join(tmpdir(), 'pan-native-preservation-'));
    roots.push(root);
    fixture.home = join(root, 'home');
    vi.stubEnv('OVERDECK_HOME', join(root, 'managed'));
    fixture.projects = ['absent', 'marked', 'malformed', 'linked', 'readonly'].map(key => ({ key, config: { path: join(root, key), name: key } }));
    mkdirSync(join(fixture.home, '.claude'), { recursive: true });
    writeFileSync(join(fixture.home, '.claude', 'CLAUDE.md'), 'Personal instructions\r\n', { mode: 0o444 });
    for (const { key, config } of fixture.projects) {
      mkdirSync(join(config.path, '.overdeck', 'context'), { recursive: true });
      writeFileSync(join(config.path, '.overdeck', 'context', 'project.md'), 'Project context');
      mkdirSync(join(config.path, 'nested'));
      writeFileSync(join(config.path, 'nested', 'AGENTS.md'), 'Nested user instructions');
      if (key === 'absent') continue;
      if (key === 'linked') {
        writeFileSync(join(root, 'link-target'), 'User-owned symlink target');
        symlinkSync(join(root, 'link-target'), join(config.path, 'AGENTS.md'));
      } else {
        const text = key === 'marked' ? '<!-- BEGIN OVERDECK CONTEXT -->\nold\n<!-- END OVERDECK CONTEXT -->\nUser tail' : '<!-- BEGIN OVERDECK CONTEXT -->\nUnmatched, preserve me';
        writeFileSync(join(config.path, 'CLAUDE.md'), text, { mode: key === 'readonly' ? 0o444 : 0o644 });
      }
    }
    const targets = [fixture.home, ...fixture.projects.map(p => p.config.path), join(root, 'link-target')];
    const before = targets.map(snapshot);
    const { syncContextLayersSync } = await import('../../../src/lib/sync.js');
    expect(syncContextLayersSync().errors).toEqual([]);
    expect(syncContextLayersSync().errors).toEqual([]);
    expect(targets.map(snapshot)).toEqual(before);
    expect(readFileSync(join(root, 'managed', 'context', 'claude-global.md'), 'utf8')).toContain('Overdeck managed instructions');
  });
});
