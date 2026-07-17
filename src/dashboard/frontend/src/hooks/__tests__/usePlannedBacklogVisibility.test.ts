import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectFeature } from '../../components/CommandDeck/ProjectTree/ProjectNode';
import { filterSpecOnlyPlanned } from '../../components/CommandDeck/projectsData';

const STORAGE_KEY = 'overdeck.ui.showPlannedBacklog';

function feature(issueId: string, specOnlyPlanned?: boolean): ProjectFeature {
  return {
    issueId,
    title: issueId,
    projectName: 'overdeck',
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'idle',
    stateLabel: 'Idle',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    specOnlyPlanned,
  };
}

describe('usePlannedBacklogVisibility', () => {
  let stored: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    stored = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => stored[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        stored[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete stored[key];
      }),
      clear: vi.fn(() => {
        stored = {};
      }),
      length: 0,
      key: vi.fn(() => null),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to visible when the preference is missing or invalid', async () => {
    const missing = await import('../usePlannedBacklogVisibility');
    expect(missing.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(true);

    vi.resetModules();
    stored[STORAGE_KEY] = 'invalid';
    const invalid = await import('../usePlannedBacklogVisibility');
    expect(invalid.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(true);
  });

  it('keeps an in-memory preference when localStorage is unavailable', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const unavailable = await import('../usePlannedBacklogVisibility');
    expect(unavailable.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(true);

    unavailable.usePlannedBacklogVisibility.getState().toggleShowPlannedBacklog();
    expect(unavailable.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(false);
  });

  it('persists toggles and restores them on a fresh store load', async () => {
    const initial = await import('../usePlannedBacklogVisibility');

    initial.usePlannedBacklogVisibility.getState().toggleShowPlannedBacklog();

    expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'false');
    expect(initial.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(false);

    vi.resetModules();
    const restored = await import('../usePlannedBacklogVisibility');
    expect(restored.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(false);

    restored.usePlannedBacklogVisibility.getState().toggleShowPlannedBacklog();
    expect(localStorage.setItem).toHaveBeenLastCalledWith(STORAGE_KEY, 'true');
    expect(restored.usePlannedBacklogVisibility.getState().showPlannedBacklog).toBe(true);
  });
});

describe('filterSpecOnlyPlanned', () => {
  const features = [
    feature('PAN-1', true),
    feature('PAN-2', false),
    feature('PAN-3'),
  ];

  it('returns the original feature array when planned backlog is visible', () => {
    expect(filterSpecOnlyPlanned(features, true)).toBe(features);
  });

  it('hides only features explicitly marked spec-only planned', () => {
    expect(filterSpecOnlyPlanned(features, false).map((item) => item.issueId)).toEqual([
      'PAN-2',
      'PAN-3',
    ]);
  });
});
