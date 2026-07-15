import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

function run(cwd: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(file, args, { cwd, encoding: 'utf8', env: { ...process.env, BD_NON_INTERACTIVE: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim();
}

function git(cwd: string, ...args: string[]): string { return run(cwd, 'git', args); }
function bd(cwd: string, ...args: string[]): string { return run(cwd, 'bd', args); }

const hasBd = (() => {
  try {
    execFileSync('bd', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function clone(remote: string, target: string): void {
  run(join(target, '..'), 'git', ['clone', '-q', remote, target]);
  git(target, 'config', 'user.name', 'Cross Machine Test');
  git(target, 'config', 'user.email', 'cross-machine@example.com');
  git(target, 'config', 'tasks.role', 'maintainer');
}

describe.skipIf(!hasBd)('Dolt cross-machine tasks authority', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('bootstraps clones, transports closes, and converges divergent different-row writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-cross-machine-'));
    roots.push(root);
    const remote = join(root, 'origin.git');
    const a = join(root, 'a');
    mkdirSync(a);
    git(a, 'init', '-q');
    git(a, 'config', 'user.name', 'Cross Machine Test');
    git(a, 'config', 'user.email', 'cross-machine@example.com');
    writeFileSync(join(a, 'README.md'), 'fixture\n');
    git(a, 'add', 'README.md');
    git(a, 'commit', '-q', '-m', 'fixture');
    git(root, 'init', '--bare', '-q', remote);
    git(a, 'remote', 'add', 'origin', remote);
    git(a, 'push', '-q', '-u', 'origin', 'HEAD:main');
    git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    bd(a, 'init', '--prefix', 'xmc', '--skip-agents', '--skip-hooks');
    git(a, 'config', 'tasks.role', 'maintainer');
    bd(a, 'dolt', 'remote', 'add', 'origin', `file://${remote}`);

    const ids = Array.from({ length: 5 }, (_, index) => bd(a, 'create', `PAN-1 task ${index + 1}`, '-l', 'pan-1', '--silent'));
    bd(a, 'dolt', 'push');

    const b = join(root, 'b');
    clone(remote, b);
    bd(b, 'bootstrap', '--yes', '--json');
    expect(JSON.parse(bd(b, 'list', '--all', '--json', '--limit', '0'))).toHaveLength(5);
    for (const id of ids) bd(b, 'close', id, '--reason', 'done');
    bd(b, 'dolt', 'push');

    const c = join(root, 'c');
    clone(remote, c);
    bd(c, 'bootstrap', '--yes', '--json');
    const closed = JSON.parse(bd(c, 'list', '-l', 'pan-1', '--status', 'closed', '--json', '--limit', '0')) as Array<{ id: string }>;
    expect(closed).toHaveLength(5);

    // Divergent different-row writes: B and C start at the same head. B wins
    // the first push; C is rejected, pulls with bd's merge, then publishes the
    // converged history. No force push is used.
    const bOnly = bd(b, 'create', 'B-only row', '-l', 'pan-1', '--silent');
    const cOnly = bd(c, 'create', 'C-only row', '-l', 'pan-1', '--silent');
    bd(b, 'dolt', 'push');
    expect(() => bd(c, 'dolt', 'push')).toThrow();
    bd(c, 'dolt', 'pull');
    bd(c, 'dolt', 'push');
    bd(b, 'dolt', 'pull');
    const converged = JSON.parse(bd(b, 'list', '--all', '--json', '--limit', '0')) as Array<{ id: string }>;
    expect(converged.some((row) => row.id === bOnly)).toBe(true);
    expect(converged.some((row) => row.id === cOnly)).toBe(true);
  }, 120_000);
});
