import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-harness-storage.sh', import.meta.url);
// Built from parts so this test file carries no storage literal of its own.
const CLAUDE_PROJECTS = ["'.cl" + "aude'", "'proj" + "ects'"].join(', ');
const KIMI_HOME = "'.ki" + "mi-code'";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Copy the guard into a temp repo, with `allow` replacing the real allowlist rows. */
function makeRepo(allow: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-harness-storage-'));
  roots.push(root);
  const source = readFileSync(SCRIPT_SOURCE, 'utf-8');
  const rewritten = source.replace(
    /(<<'ALLOW'\n)[\s\S]*?(\nALLOW\n)/,
    (_m, open: string, close: string) => `${open}${allow.join('\n')}${close}`,
  );
  expect(rewritten).not.toBe(source);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lint-harness-storage.sh'), rewritten, { mode: 0o755 });
  return root;
}

function writeSource(root: string, path: string, lines: string[]): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, lines.join('\n') + '\n');
}

function runGuard(root: string) {
  return spawnSync('bash', [join(root, 'scripts', 'lint-harness-storage.sh')], { encoding: 'utf-8' });
}

describe('lint-harness-storage.sh', () => {
  it('fails on a storage literal outside src/lib/runtimes/storage/', () => {
    const root = makeRepo();
    writeSource(root, 'src/lib/agents/finder.ts', [
      "import { join } from 'node:path';",
      `export const dir = join('/home/u', ${CLAUDE_PROJECTS});`,
    ]);
    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('src/lib/agents/finder.ts:2');
  });

  it('passes the same literal inside src/lib/runtimes/storage/', () => {
    const root = makeRepo();
    writeSource(root, 'src/lib/runtimes/storage/claude-code.ts', [
      "import { join } from 'node:path';",
      `export const dir = join('/home/u', ${CLAUDE_PROJECTS});`,
    ]);
    const result = runGuard(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('harness storage paths live only in src/lib/runtimes/storage/');
  });

  it('passes an allowlisted line', () => {
    const root = makeRepo(['src/lib/harness-binary.ts:2 # PAN-3958 binary dir, not transcript storage']);
    writeSource(root, 'src/lib/harness-binary.ts', [
      "import { join } from 'node:path';",
      `export const bin = join('/home/u', ${KIMI_HOME}, 'bin');`,
    ]);
    expect(runGuard(root).status).toBe(0);
  });

  it('ignores comment lines and test files', () => {
    const root = makeRepo();
    writeSource(root, 'src/lib/agents/doc.ts', [
      `// lives under join(home, ${CLAUDE_PROJECTS})`,
      ` * or join(home, ${KIMI_HOME})`,
      'export const x = 1;',
    ]);
    writeSource(root, 'src/lib/agents/__tests__/doc.test.ts', [`const d = [${KIMI_HOME}];`]);
    expect(runGuard(root).status).toBe(0);
  });

  it('fails on a stale allowlist row', () => {
    const root = makeRepo(['src/lib/gone.ts:9 # PAN-3958 no longer here']);
    writeSource(root, 'src/lib/gone.ts', ['export const x = 1;']);
    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('stale allowlist row');
  });
});
