import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-last-verified.sh', import.meta.url);
const MAP_DIR = ['.overdeck', 'context', 'codebase'];

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lint-last-verified-'));
}

function installScript(root: string): string {
  const scriptDest = join(root, 'scripts', 'lint-last-verified.sh');
  const src = readFileSync(SCRIPT_SOURCE, 'utf-8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(scriptDest, src, { mode: 0o755 });
  return scriptDest;
}

function writeMapFile(root: string, name: string, content: string): void {
  const dir = join(root, ...MAP_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

function runLint(root: string): { ok: boolean; output: string } {
  const script = join(root, 'scripts', 'lint-last-verified.sh');
  try {
    const output = execFileSync('bash', [script], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (err: any) {
    return {
      ok: false,
      output: [err.stdout ?? '', err.stderr ?? ''].join('\n'),
    };
  }
}

describe('lint-last-verified.sh', () => {
  it('passes when every map file ends with a date-only footer', () => {
    const root = makeTempDir();
    installScript(root);
    for (const name of ['architecture.md', 'concerns.md', 'conventions.md', 'stack.md']) {
      writeMapFile(root, name, `# ${name}\n\n<!-- last-verified: 2026-11-04 -->\n`);
    }

    const result = runLint(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('lint:last-verified passed (4 footer lines checked)');
  });

  it('fails when a footer carries issue ids', () => {
    const root = makeTempDir();
    installScript(root);
    writeMapFile(
      root,
      'architecture.md',
      '# architecture.md\n\n<!-- last-verified: 2026-11-04 (PAN-1, PAN-2) -->\n',
    );

    const result = runLint(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('.overdeck/context/codebase/architecture.md:');
    expect(result.output).toContain('holds only the date');
  });

  it('passes when a file has two date-only footers (union-merge artifact)', () => {
    const root = makeTempDir();
    installScript(root);
    writeMapFile(
      root,
      'concerns.md',
      '# concerns.md\n\n<!-- last-verified: 2026-11-04 -->\n- a bullet\n<!-- last-verified: 2026-11-05 -->\n',
    );

    const result = runLint(root);

    expect(result.ok).toBe(true);
  });

  it('passes when the codebase map directory is absent', () => {
    const root = makeTempDir();
    installScript(root);

    const result = runLint(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('no codebase map');
  });

  it('passes when a footer is only mentioned mid-line in prose', () => {
    const root = makeTempDir();
    installScript(root);
    writeMapFile(
      root,
      'architecture.md',
      '# architecture.md\n\n- The `<!-- last-verified -->` footer holds a date.\n\n<!-- last-verified: 2026-11-04 -->\n',
    );

    const result = runLint(root);

    expect(result.ok).toBe(true);
  });
});
