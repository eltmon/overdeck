import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const SCRIPT_SOURCE = join(REPO_ROOT, 'scripts', 'lint-state-writes.sh');
const tempRoots: string[] = [];

function makeFixture(filePath: string, source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'orders-two-door-'));
  tempRoots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lint-state-writes.sh'), readFileSync(SCRIPT_SOURCE, 'utf8'), { mode: 0o755 });
  writeFileSync(join(root, 'scripts', 'state-write-allowlist.txt'), '');
  const target = join(root, filePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture', '--quiet'], { cwd: root });
  return root;
}

function runGuard(root: string): { ok: boolean; output: string } {
  try {
    return {
      ok: true,
      output: execFileSync('bash', ['scripts/lint-state-writes.sh'], { cwd: root, encoding: 'utf8' }),
    };
  } catch (cause) {
    const error = cause as { stdout?: string; stderr?: string };
    return { ok: false, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` };
  }
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

describe('orders two-door state guard', () => {
  it('rejects direct orders/*.json reads outside src/lib/orders', () => {
    const root = makeFixture('src/rogue-orders-reader.ts', `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function readBook(root: string) {
  return readFileSync(join(root, 'orders', 'campaign.json'), 'utf8');
}
`);

    const result = runGuard(root);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('direct orders/*.json access outside src/lib/orders/');
    expect(result.output).toContain('src/rogue-orders-reader.ts');
    expect(result.output).toContain('resolver.ts');
    expect(result.output).toContain('writer.ts');
  });

  it('allows the canonical orders domain and passes against the landing tree', () => {
    const fixture = makeFixture('src/lib/orders/io.ts', `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function readBook(root: string) {
  return readFileSync(join(root, 'orders', 'campaign.json'), 'utf8');
}
`);
    expect(runGuard(fixture)).toMatchObject({ ok: true });

    const realTree = runGuard(REPO_ROOT);
    expect(realTree.ok).toBe(true);
    expect(realTree.output).toContain('✓ state-write lint passed');
  });
});
