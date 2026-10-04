/**
 * PAN-4541: a regex-based scanner read a package name inside a JSDoc comment
 * (`distinguishes the "zen" route from "custom"`) as a real import and
 * blocked every `pan reload`. These lock the lexer-based replacement's
 * behaviour: only genuine import/export specifiers count.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { unresolvedBundleImports } from '../../../src/lib/bundle-imports.js';

let tmpRoot: string;

/** A fake bundle file at `<tmpRoot>/<name>/bundle.js`, with `source` as its body. */
function makeBundle(name: string, source: string): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'bundle.js');
  writeFileSync(scriptPath, source);
  return scriptPath;
}

/** Installs a resolvable package named `installed-pkg` next to `scriptPath`. */
function installPackage(scriptPath: string): void {
  const packageDir = join(scriptPath, '..', 'node_modules', 'installed-pkg');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{"name":"installed-pkg","main":"index.js"}\n');
  writeFileSync(join(packageDir, 'index.js'), 'module.exports = {};\n');
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'bundle-imports-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('unresolvedBundleImports', () => {
  it('ignores package names inside comments and string literals', () => {
    const scriptPath = makeBundle(
      'comments-and-strings',
      [
        '// x from "nonexistent-pkg"',
        '/** distinguishes the "zen" route from "custom". */',
        'const a = "import(\\"nonexistent-pkg\\")";',
        'const b = `from "nonexistent-pkg"`;',
        'const c = /from "nonexistent-pkg"/;',
        'import { a as realImport } from "installed-pkg";',
        'export { realImport, a, b, c };',
      ].join('\n'),
    );
    installPackage(scriptPath);

    expect(unresolvedBundleImports(scriptPath)).toEqual([]);
  });

  it('reports a real import that does not resolve', () => {
    const scriptPath = makeBundle('missing-static', 'import x from "really-missing-pkg";\nexport { x };\n');

    expect(unresolvedBundleImports(scriptPath)).toEqual(['really-missing-pkg']);
  });

  it('reports a real dynamic import with a literal specifier', () => {
    const scriptPath = makeBundle(
      'missing-dynamic',
      'export const m = await import("really-missing-dyn");\n',
    );

    expect(unresolvedBundleImports(scriptPath)).toEqual(['really-missing-dyn']);
  });

  it('ignores import.meta and non-literal dynamic imports', () => {
    const scriptPath = makeBundle(
      'meta-and-non-literal',
      'const name = "really-missing-dyn";\nimport.meta.url;\nimport(name);\n',
    );

    expect(unresolvedBundleImports(scriptPath)).toEqual([]);
  });

  it('reports export-from re-exports', () => {
    const scriptPath = makeBundle('missing-reexport', 'export * from "really-missing-reexport";\n');

    expect(unresolvedBundleImports(scriptPath)).toEqual(['really-missing-reexport']);
  });
});
