import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureWorkspaceBeadsRedirect } from '../workspace-beads.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ensureWorkspaceBeadsRedirect', () => {
  it('atomically creates and repairs the legacy redirect idempotently', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'workspace-beads-redirect-'));
    roots.push(workspace);
    const redirect = await ensureWorkspaceBeadsRedirect(workspace, null);
    expect(readFileSync(redirect, 'utf8')).toBe('../../.beads');

    writeFileSync(redirect, '/stale/machine/path');
    expect(await ensureWorkspaceBeadsRedirect(workspace, null)).toBe(redirect);
    expect(readFileSync(redirect, 'utf8')).toBe('../../.beads');
    expect(() => mkdirSync(join(workspace, '.beads'), { recursive: true })).not.toThrow();
  });
});
