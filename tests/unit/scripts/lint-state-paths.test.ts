import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-state-paths.sh', import.meta.url);
const tempRoots: string[] = [];

function makeFixture(): { root: string; scanRoot: string; script: string } {
  const root = mkdtempSync(join(tmpdir(), 'lint-state-paths-'));
  tempRoots.push(root);
  const scanRoot = join(root, 'src');
  const script = join(root, 'scripts', 'lint-state-paths.sh');
  mkdirSync(scanRoot, { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(script, readFileSync(SCRIPT_SOURCE, 'utf-8'), { mode: 0o755 });
  return { root, scanRoot, script };
}

function runGuard(root: string, scanRoot: string, script: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('bash', [script, scanRoot], { cwd: root, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (error: any) {
    return {
      ok: false,
      output: [error.stdout ?? '', error.stderr ?? ''].join('\n'),
    };
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('lint-state-paths.sh', () => {
  it('fails with file and line for a hardcoded spec-directory join', () => {
    const fixture = makeFixture();
    const sourcePath = join(fixture.scanRoot, 'lib', 'orphan.ts');
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(sourcePath, "const specsDir = join(projectRoot, '.pan', 'specs');\n");

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("src/lib/orphan.ts:1:const specsDir = join(projectRoot, '.pan', 'specs');");
    expect(result.output).toContain('Use getProjectPanPaths(projectRoot)');
  });

  it.each(['specs', 'drafts'] as const)('fails for a multiline hardcoded %s-directory join', (directory) => {
    const fixture = makeFixture();
    const sourcePath = join(fixture.scanRoot, 'lib', `${directory}.ts`);
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(sourcePath, [
      'const stateDir = join(',
      '  projectRoot,',
      "  '.pan',",
      `  '${directory}',`,
      ');',
      '',
    ].join('\n'));

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(`src/lib/${directory}.ts:3:`);
    expect(result.output).toContain('Use getProjectPanPaths(projectRoot)');
  });

  it.each(['specs', 'drafts'] as const)('fails for template-literal joined %s paths', (directory) => {
    const fixture = makeFixture();
    const sourcePath = join(fixture.scanRoot, 'lib', `template-${directory}.ts`);
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(sourcePath, `const stateDir = join(projectRoot, \`.pan\`, \`${directory}\`);\n`);

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(`src/lib/template-${directory}.ts:1:`);
    expect(result.output).toContain('Use getProjectPanPaths(projectRoot)');
  });

  it.each(['specs', 'drafts'] as const)('fails for template-literal slash-form %s paths', (directory) => {
    const fixture = makeFixture();
    const sourcePath = join(fixture.scanRoot, 'lib', `slash-${directory}.ts`);
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(sourcePath, `const stateDir = join(projectRoot, \`.pan/${directory}\`);\n`);

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(`src/lib/slash-${directory}.ts:1:`);
    expect(result.output).toContain('Use getProjectPanPaths(projectRoot)');
  });

  it('passes comment-only legacy path mentions', () => {
    const fixture = makeFixture();
    const sourcePath = join(fixture.scanRoot, 'lib', 'comment.ts');
    mkdirSync(join(fixture.scanRoot, 'lib'), { recursive: true });
    writeFileSync(sourcePath, [
      "// Legacy join(projectRoot, '.pan', 'drafts') was removed.",
      '/* The old .pan/specs directory is a fallback read only. */',
      'export const current = true;',
      '',
    ].join('\n'));

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('state-path lint passed');
  });

  it('passes audited path-authority modules that retain legacy fallback literals', () => {
    const fixture = makeFixture();
    const sourcePath = join(fixture.scanRoot, 'lib', 'pan-dir', 'paths.ts');
    mkdirSync(join(fixture.scanRoot, 'lib', 'pan-dir'), { recursive: true });
    writeFileSync(sourcePath, "const legacySpecs = join(root, '.pan', 'specs');\n");

    const result = runGuard(fixture.root, fixture.scanRoot, fixture.script);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('state-path lint passed');
  });

  it('preserves audited allowlists when scanning a nested source root', () => {
    const fixture = makeFixture();
    const nestedRoot = join(fixture.scanRoot, 'lib');
    const sourcePath = join(nestedRoot, 'pan-dir', 'paths.ts');
    mkdirSync(join(nestedRoot, 'pan-dir'), { recursive: true });
    writeFileSync(sourcePath, "const legacySpecs = join(root, '.pan', 'specs');\n");

    const result = runGuard(fixture.root, nestedRoot, fixture.script);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('state-path lint passed');
  });
});
