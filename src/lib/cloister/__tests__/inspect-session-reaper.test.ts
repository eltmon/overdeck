import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mockExistsSync = vi.fn();
const mockListSessionNames = vi.fn();
const mockIsPaneDead = vi.fn();
const mockKillSession = vi.fn();
const mockLogDeaconEventSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  };
});

vi.mock('../../paths.js', () => ({
  AGENTS_DIR: '/tmp/overdeck-agents',
}));

vi.mock('../../tmux.js', () => ({
  listSessionNames: () => Effect.promise(() => Promise.resolve(mockListSessionNames())),
  isPaneDead: (session: string) => Effect.promise(() => Promise.resolve(mockIsPaneDead(session))),
  killSession: (session: string) => Effect.promise(() => Promise.resolve(mockKillSession(session))),
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: (...args: unknown[]) => mockLogDeaconEventSync(...args),
}));

import { cleanupOrphanedInspectSessions } from '../inspect-session-reaper.js';

describe('cleanupOrphanedInspectSessions (PAN-1559)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessionNames.mockReturnValue([]);
    mockExistsSync.mockReturnValue(true);
    mockIsPaneDead.mockReturnValue(false);
  });

  it('kills live inspect sessions that have no state.json', async () => {
    mockListSessionNames.mockReturnValue([
      'inspect-pan-1549-workspace-5u66k',
      'agent-pan-1549',
    ]);
    mockExistsSync.mockReturnValue(false);
    mockIsPaneDead.mockReturnValue(false);

    const actions = await cleanupOrphanedInspectSessions();

    expect(actions).toEqual([
      'Killed orphaned inspect session inspect-pan-1549-workspace-5u66k (missing state.json)',
    ]);
    expect(mockKillSession).toHaveBeenCalledWith('inspect-pan-1549-workspace-5u66k');
    expect(mockKillSession).not.toHaveBeenCalledWith('agent-pan-1549');
  });

  it('kills inspect sessions whose pane is dead even when state exists', async () => {
    mockListSessionNames.mockReturnValue(['inspect-pan-1559-bead-1']);
    mockExistsSync.mockReturnValue(true);
    mockIsPaneDead.mockReturnValue(true);

    const actions = await cleanupOrphanedInspectSessions();

    expect(actions).toEqual([
      'Killed orphaned inspect session inspect-pan-1559-bead-1 (pane is dead)',
    ]);
    expect(mockKillSession).toHaveBeenCalledWith('inspect-pan-1559-bead-1');
  });

  it('keeps live tracked inspect sessions', async () => {
    mockListSessionNames.mockReturnValue(['inspect-pan-1559-bead-2']);
    mockExistsSync.mockReturnValue(true);
    mockIsPaneDead.mockReturnValue(false);

    await expect(cleanupOrphanedInspectSessions()).resolves.toEqual([]);
    expect(mockKillSession).not.toHaveBeenCalled();
  });
});
