import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/lint-beads-access.sh');
const roots: string[] = [];

function fixture(path: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'beads-access-'));
  roots.push(root);
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return root;
}

function run(root: string, env: NodeJS.ProcessEnv = {}): void {
  execFileSync('/usr/bin/bash', [script, root], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('beads access audit', () => {
  it.each([
    ['direct JSONL read', "readFileSync('.beads/issues.jsonl')"],
    ['JSONL existence truth', "existsSync('.beads/issues.jsonl')"],
    ['raw mutation', "execSync('bd close task-1')"],
  ])('rejects %s', (_name, content) => {
    expect(() => run(fixture('src/bad.ts', content))).toThrow();
  });

  it('allows the recovery/export adapter and canonical doors', () => {
    const root = fixture('src/lib/beads/export.ts', "readFileSync('.beads/issues.jsonl')");
    mkdirSync(join(root, 'src/lib/beads'), { recursive: true });
    mkdirSync(join(root, 'sync-sources/skills'), { recursive: true });
    writeFileSync(join(root, 'src/lib/beads/resolver.ts'), "execFile('bd', ['list'])");
    writeFileSync(join(root, 'src/lib/beads/writer.ts'), "execFile('bd', ['close', id])");
    expect(() => run(root)).not.toThrow();
  });

  it('fails clearly when ripgrep is unavailable', () => {
    const root = fixture('src/ok.ts', 'export const ok = true;');
    const emptyPath = join(root, 'empty-bin');
    mkdirSync(emptyPath);

    try {
      run(root, { PATH: emptyPath });
      throw new Error('expected beads access audit to fail without rg');
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? '';
      expect(stderr).toContain('ripgrep (rg) is required');
    }
  });
});
