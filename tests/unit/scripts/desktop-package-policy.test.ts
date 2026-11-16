import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanImportClosure } from '../../../apps/desktop/scripts/import-closure.mjs';
import { SERVER_SKIP_PACKAGES } from '../../../apps/desktop/scripts/package-policy.mjs';

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
