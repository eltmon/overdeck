import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { removePendingPromotionMarker } from '../planning-promotion.js';

const roots: string[] = [];

function createWorkspace(): { root: string; workspacePath: string; markerPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'planning-promotion-marker-cleanup-'));
  roots.push(root);
  const workspacePath = join(root, 'workspaces', 'feature-pan-3229');
  const markerPath = join(workspacePath, '.overdeck', 'pending-promotion.json');
  mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
  return { root, workspacePath, markerPath };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('planning promotion marker cleanup', () => {
  it('removes a pending-promotion marker before the success response path returns', async () => {
    const { workspacePath, markerPath } = createWorkspace();
    writeFileSync(markerPath, '{"version":"1"}\n');
    const log = vi.fn();

    await expect(removePendingPromotionMarker(workspacePath, log)).resolves.toBe(true);

    expect(existsSync(markerPath)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Removed pending-promotion marker'));
  });

  it('tolerates an absent marker without logging a removal', async () => {
    const { workspacePath, markerPath } = createWorkspace();
    const log = vi.fn();

    await expect(removePendingPromotionMarker(workspacePath, log)).resolves.toBe(false);

    expect(existsSync(markerPath)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
