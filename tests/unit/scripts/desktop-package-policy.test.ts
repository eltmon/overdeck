import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanImportClosure } from '../../../apps/desktop/scripts/import-closure.mjs';
import { checkDesktopPackSize, findForbiddenPackages, SERVER_SKIP_PACKAGES } from '../../../apps/desktop/scripts/package-policy.mjs';

/**
 * PAN-5424: PAN-5358's namespace dynamic import of index-builder left a JSDoc
 * `from "@huggingface/transformers"` string reachable in the bundled
 * transformers chunk. scanImportClosure's regex scan matched that string as a
 * real external, so the staged desktop server installed transformers and its
 * ~720 MB of onnxruntime. These tests lock the skip that keeps it out.
 */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('desktop package policy', () => {
  it('drops @huggingface/transformers matched only through a JSDoc example', () => {
    const dir = mkdtempSync(join(tmpdir(), 'desktop-package-policy-'));
    roots.push(dir);
    writeFileSync(join(dir, 'server.js'), 'import "./transformers.node-abc.js";\nimport { parse } from "yaml";\n');
    writeFileSync(
      join(dir, 'transformers.node-abc.js'),
      '/**\n* import { AutoTokenizer } from "@huggingface/transformers";\n*/\nconst ort = requireFromHere("onnxruntime-node");\nexport {};\n',
    );

    const skipped = scanImportClosure(dir, ['server.js'], SERVER_SKIP_PACKAGES);
    expect(skipped.packages).toEqual(new Set(['yaml']));

    const unskipped = scanImportClosure(dir, ['server.js']);
    expect(unskipped.packages.has('@huggingface/transformers')).toBe(true);
  });

  it('keeps the pre-existing skips', () => {
    expect(SERVER_SKIP_PACKAGES.has('@effect/platform-bun')).toBe(true);
    expect(SERVER_SKIP_PACKAGES.has('playwright')).toBe(true);
    expect(SERVER_SKIP_PACKAGES.has('playwright-core')).toBe(true);
  });
});

const writePackageDir = (dir: string, relPath: string) => {
  const pkgDir = join(dir, ...relPath.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), '{}\n');
};

describe('findForbiddenPackages', () => {
  const makeRoot = () => {
    const dir = mkdtempSync(join(tmpdir(), 'desktop-forbidden-packages-'));
    roots.push(dir);
    return dir;
  };

  it('finds a top-level hit', () => {
    const dir = makeRoot();
    writePackageDir(dir, 'onnxruntime-node');
    expect(findForbiddenPackages(dir)).toEqual(['onnxruntime-node']);
  });

  it('finds a nested hit', () => {
    const dir = makeRoot();
    writePackageDir(dir, 'foo/node_modules/onnxruntime-web');
    expect(findForbiddenPackages(dir)).toEqual([join('foo', 'node_modules', 'onnxruntime-web')]);
  });

  it('finds a scoped hit', () => {
    const dir = makeRoot();
    writePackageDir(dir, '@huggingface/transformers');
    expect(findForbiddenPackages(dir)).toEqual(['@huggingface/transformers']);
  });

  it('returns empty for a clean tree', () => {
    const dir = makeRoot();
    writePackageDir(dir, 'yaml');
    writePackageDir(dir, '@scope/pkg');
    expect(findForbiddenPackages(dir)).toEqual([]);
  });

  it('returns empty for a missing directory', () => {
    const dir = makeRoot();
    expect(findForbiddenPackages(join(dir, 'does-not-exist'))).toEqual([]);
  });
});

describe('checkDesktopPackSize', () => {
  it('passes a tarball under the limit', () => {
    const result = checkDesktopPackSize({ size: 133_300_000, unpackedSize: 300_000_000, entryCount: 100 });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('133.3 MB');
  });

  it('passes a tarball exactly at the limit (inclusive)', () => {
    const result = checkDesktopPackSize({ size: 300_000_000 });
    expect(result.ok).toBe(true);
  });

  it('fails a tarball over the limit', () => {
    const result = checkDesktopPackSize({ size: 515_200_000 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('515.2 MB');
    expect(result.message).toContain('300.0 MB');
  });

  it('fails closed when size is missing or non-numeric', () => {
    expect(checkDesktopPackSize({ size: 'not-a-number' }).ok).toBe(false);
    expect(checkDesktopPackSize({ size: 'not-a-number' }).message).toContain('could not be measured');
    expect(checkDesktopPackSize(undefined).ok).toBe(false);
    expect(checkDesktopPackSize(undefined).message).toContain('could not be measured');
  });

  it('honors a custom limit', () => {
    expect(checkDesktopPackSize({ size: 100 }, 50).ok).toBe(false);
    expect(checkDesktopPackSize({ size: 50 }, 50).ok).toBe(true);
  });
});
