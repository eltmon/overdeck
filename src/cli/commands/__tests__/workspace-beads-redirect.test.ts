import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureWorkspaceTasksRedirect } from '../workspace-tasks.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ensureWorkspaceTasksRedirect', () => {
  it('atomically creates and repairs the legacy redirect idempotently', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'workspace-tasks-redirect-'));
    roots.push(workspace);
    const redirect = await ensureWorkspaceTasksRedirect(workspace, null);
    expect(readFileSync(redirect, 'utf8')).toBe('../../.tasks');

    writeFileSync(redirect, '/stale/machine/path');
    expect(await ensureWorkspaceTasksRedirect(workspace, null)).toBe(redirect);
    expect(readFileSync(redirect, 'utf8')).toBe('../../.tasks');
    expect(() => mkdirSync(join(workspace, '.tasks'), { recursive: true })).not.toThrow();
  });
});
