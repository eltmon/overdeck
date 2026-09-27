import { describe, expect, it, vi } from 'vitest';
import type { EffortConfigSlice } from '../resolve-effort.js';

const modelEffortLevels: Record<string, readonly string[] | undefined> = {
  'high-max-model': ['high', 'max'],
  'max-only-model': ['max'],
  'no-max-model': ['low', 'medium', 'high', 'xhigh'],
  'no-restriction-model': undefined,
};

vi.mock('../../model-capabilities.js', () => ({
  getModelEffortLevels: (model: string) => modelEffortLevels[model],
}));

const mockedProjects: Record<string, { effort?: string }> = {};
const mockedProjectForIssue: Record<string, string> = {};

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: (issueId: string) => {
    const projectKey = mockedProjectForIssue[issueId];
    return projectKey ? { projectKey, projectName: projectKey, projectPath: '/tmp', linearTeam: undefined } : null;
  },
  loadProjectsConfigSync: () => ({ projects: mockedProjects }),
}));

const { clampEffort, effortConfigErrors, supportedEffortLevels } = await import('../effort-support.js');
const { InvalidEffortError, resolveEffort } = await import('../resolve-effort.js');

describe('effort-support', () => {
  describe('supportedEffortLevels / clampEffort', () => {
    it('keeps a level the harness supports', () => {
      expect(clampEffort('high', undefined, 'ohmypi')).toEqual({ effort: 'high', clamped: false });
    });

    it('clamps a harness-unsupported level down to the highest level below it', () => {
      const result = clampEffort('max', undefined, 'ohmypi');
      expect(result.effort).toBe('xhigh');
      expect(result.clamped).toBe(true);
      expect(result.warning).toBeTruthy();
    });

    it('clamps up to the lowest supported level when nothing ranks below the request', () => {
      const result = clampEffort('low', 'high-max-model');
      expect(result.effort).toBe('high');
      expect(result.clamped).toBe(true);
      expect(result.warning).toBeTruthy();
    });

    it('keeps the requested level with a warning when model and harness restrictions do not overlap', () => {
      // model restricts to {max}, harness (ohmypi) restricts to {low, medium, high, xhigh} -> empty intersection
      const result = clampEffort('max', 'max-only-model', 'ohmypi');
      expect(result.effort).toBe('max');
      expect(result.clamped).toBe(false);
      expect(result.warning).toBeTruthy();
    });

    it('returns all five levels when neither model nor harness restricts', () => {
      expect(supportedEffortLevels()).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(supportedEffortLevels('no-restriction-model')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });
  });

  describe('effortConfigErrors', () => {
    it('returns no errors for an undefined effort', () => {
      expect(effortConfigErrors('roles.work', undefined, [])).toEqual([]);
    });

    it('flags a non-canonical effort value', () => {
      expect(effortConfigErrors('roles.work', 'bogus', [])).toEqual([
        'roles.work.effort must be one of low, medium, high, xhigh, max',
      ]);
    });

    it('flags a level the resolved model does not support', () => {
      expect(effortConfigErrors('roles.work', 'max', ['high-max-model'])).toEqual([]);
      expect(effortConfigErrors('roles.work', 'low', ['high-max-model'])).toEqual([
        "roles.work.effort 'low' is not supported by high-max-model (supported: high, max)",
      ]);
    });
  });
});

describe('resolveEffort', () => {
  const config = {
    tieredExecution: {
      tiers: {
        fast: { effort: 'medium' },
      },
    },
    roles: {
      work: {
        effort: 'low',
        sub: {
          specialist: { effort: 'high' },
        },
      },
    },
  } as unknown as EffortConfigSlice;

  mockedProjectForIssue['PAN-1'] = 'overdeck';
  mockedProjects.overdeck = { effort: 'xhigh' };

  it.each([
    {
      name: 'explicit wins over every other layer',
      input: { explicit: 'max', itemEffort: 'high', planEffort: 'high', tierName: 'fast', role: 'work' as const, subRole: 'specialist', issueId: 'PAN-1', config },
      expected: { requested: 'max', source: 'explicit' },
    },
    {
      name: 'item wins once explicit is unset',
      input: { itemEffort: 'high', planEffort: 'medium', tierName: 'fast', role: 'work' as const, subRole: 'specialist', issueId: 'PAN-1', config },
      expected: { requested: 'high', source: 'item' },
    },
    {
      name: 'plan wins once item is unset',
      input: { planEffort: 'medium', tierName: 'fast', role: 'work' as const, subRole: 'specialist', issueId: 'PAN-1', config },
      expected: { requested: 'medium', source: 'plan' },
    },
    {
      name: 'tier wins once plan is unset',
      input: { tierName: 'fast', role: 'work' as const, subRole: 'specialist', issueId: 'PAN-1', config },
      expected: { requested: 'medium', source: 'tier' },
    },
    {
      name: 'sub-role wins once tier is unset',
      input: { role: 'work' as const, subRole: 'specialist', issueId: 'PAN-1', config },
      expected: { requested: 'high', source: 'sub-role' },
    },
    {
      name: 'role wins once sub-role is unset',
      input: { role: 'work' as const, issueId: 'PAN-1', config },
      expected: { requested: 'low', source: 'role' },
    },
    {
      name: 'project wins once role is unset',
      input: { issueId: 'PAN-1', config },
      expected: { requested: 'xhigh', source: 'project' },
    },
    {
      name: 'default wins when nothing else is set',
      input: { config },
      expected: { requested: 'high', source: 'default' },
    },
  ])('$name', ({ input, expected }) => {
    const result = resolveEffort(input);
    expect(result.requested).toBe(expected.requested);
    expect(result.source).toBe(expected.source);
  });

  it('throws InvalidEffortError for a bogus explicit value', () => {
    expect(() => resolveEffort({ explicit: 'bogus', config })).toThrow(InvalidEffortError);
  });

  it('falls through a bogus itemEffort to the next layer', () => {
    const result = resolveEffort({ itemEffort: 'bogus', planEffort: 'medium', config });
    expect(result).toMatchObject({ requested: 'medium', source: 'plan' });
  });

  it('clamps down when the model does not support the resolved level (pan start shape)', () => {
    const result = resolveEffort({ role: 'work' as const, explicit: 'max', model: 'no-max-model', config });
    expect(result.requested).toBe('max');
    expect(result.effort).toBe('xhigh');
    expect(result.clamped).toBe(true);
    expect(result.warning).toBeTruthy();
  });
});
