import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { removeWorkspaceDirectory } from '../../../../src/lib/workspace-manager/remove-directory.js';

function makeWorkspacesTree(): { root: string; workspaces: string } {
  const root = mkdtempSync(join(tmpdir(), 'remove-dir-'));
  const workspaces = join(root, 'workspaces');
  mkdirSync(workspaces);
  return { root, workspaces };
}

describe('removeWorkspaceDirectory (PAN-3717)', () => {
  it('removes a real slot directory without ever invoking the Docker fallback', async () => {
    const { root, workspaces } = makeWorkspacesTree();
    try {
      const slot = join(workspaces, 'feature-min-888-slot-2');
      mkdirSync(join(slot, 'fe'), { recursive: true });
      writeFileSync(join(slot, 'fe', 'marker.txt'), 'x');
      const dockerClean = vi.fn(async () => undefined);

      await removeWorkspaceDirectory(slot, { dockerClean });

      expect(existsSync(slot)).toBe(false);
      expect(dockerClean).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the bounded Docker cleanup when host-side removal hits EACCES, then removes the emptied directory', async () => {
    const { root, workspaces } = makeWorkspacesTree();
    try {
      const slot = join(workspaces, 'feature-min-888-slot-2');
      mkdirSync(join(slot, 'fe', '.pnpm-store', 'v10'), { recursive: true });
      // First pass fails the way the root-owned container artifact makes it
      // fail; the retry after the Docker cleanup behaves like the real rm.
      const rmDep = vi.fn(async (path: string) => {
        if (rmDep.mock.calls.length === 1) {
          throw Object.assign(
            new Error(`EACCES: permission denied, rmdir '${slot}/fe/.pnpm-store/v10'`),
            { code: 'EACCES' },
          );
        }
        await rm(path, { recursive: true, force: true });
      });
      const dockerClean = vi.fn(async () => undefined);

      await removeWorkspaceDirectory(slot, { rm: rmDep, dockerClean });

      expect(dockerClean).toHaveBeenCalledTimes(1);
      expect(dockerClean).toHaveBeenCalledWith(slot);
      expect(rmDep).toHaveBeenCalledTimes(2);
      expect(existsSync(slot)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws a controlled error naming both failures when the Docker fallback also fails', async () => {
    const { root, workspaces } = makeWorkspacesTree();
    try {
      const slot = join(workspaces, 'feature-min-888-slot-2');
      mkdirSync(slot);
      const rmDep = vi.fn(async () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      });
      const dockerClean = vi.fn(async () => {
        throw new Error('Cannot connect to the Docker daemon');
      });

      await expect(removeWorkspaceDirectory(slot, { rm: rmDep, dockerClean })).rejects.toThrow(
        /EACCES: permission denied.*Docker fallback.*Cannot connect to the Docker daemon/s,
      );
      // The directory is untouched — no partial deletion masquerading as success.
      expect(existsSync(slot)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a symlink at a slot-shaped name and never mounts it into Docker', async () => {
    const { root, workspaces } = makeWorkspacesTree();
    try {
      const elsewhere = join(root, 'elsewhere');
      mkdirSync(elsewhere);
      writeFileSync(join(elsewhere, 'keep.txt'), 'precious');
      const link = join(workspaces, 'feature-min-888-slot-2');
      symlinkSync(elsewhere, link);
      const rmDep = vi.fn(async () => undefined);
      const dockerClean = vi.fn(async () => undefined);

      await expect(removeWorkspaceDirectory(link, { rm: rmDep, dockerClean })).rejects.toThrow(/refusing to remove/);

      expect(rmDep).not.toHaveBeenCalled();
      expect(dockerClean).not.toHaveBeenCalled();
      expect(existsSync(join(elsewhere, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses paths outside a workspaces/ tree', async () => {
    const { root } = makeWorkspacesTree();
    try {
      const plain = join(root, 'plain-dir');
      mkdirSync(plain);
      const dockerClean = vi.fn(async () => undefined);

      await expect(removeWorkspaceDirectory(plain, { dockerClean })).rejects.toThrow(/refusing to remove/);

      expect(dockerClean).not.toHaveBeenCalled();
      expect(existsSync(plain)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when lstat itself is denied — never misclassifies EACCES as absence', async () => {
    const { root, workspaces } = makeWorkspacesTree();
    try {
      const slot = join(workspaces, 'feature-min-888-slot-2');
      mkdirSync(slot);
      const lstatDep = vi.fn(async () => {
        throw Object.assign(new Error(`EACCES: permission denied, lstat '${slot}'`), { code: 'EACCES' });
      });
      const rmDep = vi.fn(async () => undefined);
      const dockerClean = vi.fn(async () => undefined);

      await expect(removeWorkspaceDirectory(slot, { lstat: lstatDep, rm: rmDep, dockerClean })).rejects.toThrow(
        /EACCES: permission denied/,
      );

      // Nothing was removed and the Docker bind was never mounted — the
      // caller must see the failure, not a silent "already gone".
      expect(rmDep).not.toHaveBeenCalled();
      expect(dockerClean).not.toHaveBeenCalled();
      expect(existsSync(slot)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats an already-removed directory as success so re-runs stay idempotent', async () => {
    const { root, workspaces } = makeWorkspacesTree();
    try {
      const gone = join(workspaces, 'feature-min-888-slot-2');
      const dockerClean = vi.fn(async () => undefined);

      await expect(removeWorkspaceDirectory(gone, { dockerClean })).resolves.toBeUndefined();
      expect(dockerClean).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
