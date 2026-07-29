/**
 * PAN-1990 review fix (cycle 2, durability): deleteWorkspace() must unmirror
 * workspace-scoped pins BEFORE deleting the SQLite rows. If the mirror
 * commit/push fails, the workspace + pin rows must survive untouched so a
 * retry can re-list them from the resolver and try again — the opposite
 * ordering (DB delete first) would forget the pin list forever the moment a
 * transport failure hit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

const mockUnmirrorPin = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/memory/state-mirror.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/memory/state-mirror.js')>(
    '../../../../src/lib/memory/state-mirror.js',
  );
  return { ...actual, unmirrorPin: mockUnmirrorPin };
});

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  mockUnmirrorPin.mockReset();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('deleteWorkspace unmirror-then-delete ordering', () => {
  it('leaves the workspace and pin rows untouched when the mirror commit fails, so a retry can succeed', async () => {
    const { createWorkspace, deleteWorkspace, pinDoc, upsertProjectFromConfig } = await import('../../../../src/lib/workspaces/writer.js');
    const { getWorkspaceById, listPinnedDocs } = await import('../../../../src/lib/workspaces/resolver.js');

    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    const id = await createWorkspace({ projectId: 'proj-1', kind: 'scratch', name: 'scratch', path: '/repo/overdeck-scratch' });
    await pinDoc('workspace', id, 'docs/NOTES.md');

    mockUnmirrorPin.mockRejectedValueOnce(new Error('state-door push failed'));

    await expect(deleteWorkspace(id)).rejects.toThrow('state-door push failed');

    // Nothing was deleted — the workspace and its pin survive for a retry.
    expect(getWorkspaceById(id)).not.toBeNull();
    expect(listPinnedDocs('workspace', id)).toHaveLength(1);

    // Retry succeeds once the transport issue clears.
    mockUnmirrorPin.mockResolvedValueOnce(undefined);
    await deleteWorkspace(id);

    expect(getWorkspaceById(id)).toBeNull();
    expect(listPinnedDocs('workspace', id)).toHaveLength(0);
    expect(mockUnmirrorPin).toHaveBeenCalledTimes(2);
  });
});
