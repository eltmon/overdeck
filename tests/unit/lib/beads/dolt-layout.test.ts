import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectLiveDoltLayout, isDoltRuntimePath, listLiveDoltLayout } from '../../../../src/lib/beads/dolt-layout.js';

describe('Dolt layout detection', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('detects database directories and runtime files but not derived exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'dolt-layout-'));
    roots.push(root);
    mkdirSync(join(root, 'embeddeddolt'), { recursive: true });
    writeFileSync(join(root, 'embeddeddolt', 'LOCK'), '');
    writeFileSync(join(root, 'dolt-server.pid'), '1');
    writeFileSync(join(root, 'issues.jsonl'), '{}\n');
    expect(detectLiveDoltLayout(root)).toBe(true);
    expect(listLiveDoltLayout(root)).toEqual(['dolt-server.pid', 'embeddeddolt']);
    expect(isDoltRuntimePath('.beads/backup/snapshot.jsonl')).toBe(true);
    expect(isDoltRuntimePath('.beads/issues.jsonl')).toBe(false);
  });
});
