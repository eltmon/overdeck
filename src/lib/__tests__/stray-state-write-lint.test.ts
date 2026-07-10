import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('stray state write lint', () => {
  it('rejects a direct project .pan/records write outside the doors', () => {
    const root = mkdtempSync(join(tmpdir(), 'state-write-lint-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'src', 'feature'), { recursive: true });
    cpSync(resolve('scripts/lint-state-writes.sh'), join(root, 'scripts', 'lint-state-writes.sh'));
    writeFileSync(join(root, 'scripts', 'state-write-allowlist.txt'), '');
    writeFileSync(join(root, 'src', 'feature', 'bad.ts'), "writeFileSync(join(projectRoot, '.pan/records/x.json'), '{}')\n");
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    expect(() => execFileSync('bash', ['scripts/lint-state-writes.sh'], { cwd: root })).toThrow();
  });
});
