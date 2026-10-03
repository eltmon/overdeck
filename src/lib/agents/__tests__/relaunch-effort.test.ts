import { describe, expect, it, vi } from 'vitest';
import type { EffortConfigSlice } from '../resolve-effort.js';
import type { RelaunchEffortState } from '../relaunch-effort.js';

const modelEffortLevels: Record<string, readonly string[] | undefined> = {
  'claude-opus-5-5': undefined,
};

vi.mock('../../model-capabilities.js', () => ({
  getModelEffortLevels: (model: string) => modelEffortLevels[model],
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: () => null,
  loadProjectsConfigSync: () => ({ projects: {} }),
}));

const { resolveRelaunchEffort, spawnEffortFields } = await import('../relaunch-effort.js');

const config = {
  tieredExecution: { tiers: {} },
  roles: {
    work: { effort: 'medium' },
  },
} as unknown as EffortConfigSlice;

function state(overrides: Partial<RelaunchEffortState> = {}): RelaunchEffortState {
  return {
    effort: undefined,
    effortSource: undefined,
    role: 'work',
    reviewSubRole: undefined,
    issueId: 'PAN-4253',
    model: 'claude-opus-5-5',
    harness: 'claude-code',
    ...overrides,
  };
}

describe('resolveRelaunchEffort', () => {
  it('keeps a persisted effort and its source on a matching model/harness', () => {
    const result = resolveRelaunchEffort(state({ effort: 'max', effortSource: 'role' }), {
      model: 'claude-opus-5-5',
      harness: 'claude-code',
    });
    expect(result).toEqual({ effort: 'max', source: 'role', warning: undefined });
  });

  it('re-clamps a persisted effort when the relaunch harness does not support it', () => {
    const result = resolveRelaunchEffort(state({ effort: 'max', effortSource: 'role' }), {
      harness: 'ohmypi',
    });
    expect(result.effort).toBe('xhigh');
    expect(result.source).toBe('role');
    expect(result.warning).toBeTruthy();
  });

  it('defaults the source to explicit when a persisted effort has no source', () => {
    const result = resolveRelaunchEffort(state({ effort: 'max', effortSource: undefined }));
    expect(result.source).toBe('explicit');
  });

  it('resolves legacy state (no persisted effort) through the role layer', () => {
    const result = resolveRelaunchEffort(state({ effort: undefined, role: 'work' }), { config });
    expect(result).toEqual({ effort: 'medium', source: 'role', warning: undefined });
  });

  it('resolves legacy state with no configured role effort through the default layer', () => {
    const result = resolveRelaunchEffort(state({ effort: undefined }), {
      config: { tieredExecution: { tiers: {} }, roles: {} } as unknown as EffortConfigSlice,
    });
    expect(result).toEqual({ effort: 'high', source: 'default', warning: undefined });
  });
});

describe('spawnEffortFields', () => {
  it('returns an empty object when no effort was given', () => {
    expect(spawnEffortFields(undefined, 'role')).toEqual({});
  });

  it('defaults the source to explicit when an effort is given with no source', () => {
    expect(spawnEffortFields('max', undefined)).toEqual({ effort: 'max', effortSource: 'explicit' });
  });
});
