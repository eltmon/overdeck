import { describe, expect, it } from 'vitest';

import { summarizeSyncInputChanges } from '../sync-change-summary.js';

describe('summarizeSyncInputChanges', () => {
  it('counts distinct skill dirs and rules', () => {
    const previous = {
      'sync-sources/skills/alpha/SKILL.md': 'a1',
      'sync-sources/skills/alpha/ref.md': 'a2',
      'sync-sources/skills/beta/SKILL.md': 'b1',
      'sync-sources/rules/one.md': 'r1',
      'sync-sources/rules/two.md': 'r2',
    };
    const current = {
      ...previous,
      'sync-sources/skills/alpha/SKILL.md': 'a1x',
      'sync-sources/skills/alpha/ref.md': 'a2x',
      'sync-sources/skills/beta/SKILL.md': 'b1x',
      'sync-sources/rules/one.md': 'r1x',
    };

    const result = summarizeSyncInputChanges(previous, current);

    expect(result.summary).toBe('2 skills and 1 rule changed');
    expect(result.changedKeys).toEqual([
      'sync-sources/rules/one.md',
      'sync-sources/skills/alpha/SKILL.md',
      'sync-sources/skills/alpha/ref.md',
      'sync-sources/skills/beta/SKILL.md',
    ]);
  });

  it('orders counted nouns before singletons', () => {
    const previous = {
      'sync-sources/hooks/pre.sh': 'h1',
      'sync-sources/plugins.json': 'p1',
      'global-context': 'g1',
    };
    const current = {
      'sync-sources/hooks/pre.sh': 'h2',
      'sync-sources/plugins.json': 'p2',
      'global-context': 'g2',
    };

    expect(summarizeSyncInputChanges(previous, current).summary).toBe(
      '1 hook, the plugin list, and the global context changed',
    );
  });

  it('ignores cwd keys by default', () => {
    const result = summarizeSyncInputChanges(
      { cwd: 'c1', 'cwd-skills/x/SKILL.md': 's1' },
      { cwd: 'c2', 'cwd-skills/x/SKILL.md': 's2' },
    );

    expect(result.changedKeys).toEqual([]);
    expect(result.summary).toBe('Setup inputs changed');
  });

  it('includes cwd keys when excludeCwd is false', () => {
    const result = summarizeSyncInputChanges({ cwd: 'c1' }, { cwd: 'c2' }, { excludeCwd: false });

    expect(result.changedKeys).toEqual(['cwd']);
    expect(result.summary).toBe('the working-directory skills changed');
  });

  it('reports a machine with no recorded sync', () => {
    expect(summarizeSyncInputChanges(null, { 'global-context': 'g' })).toEqual({
      summary: 'No sync has been recorded on this machine',
      changedKeys: [],
    });
  });

  it('reports a v1 manifest with no per-file record', () => {
    const result = summarizeSyncInputChanges('no-record', { 'global-context': 'g' });

    expect(result.summary.startsWith('Setup inputs changed since the last sync')).toBe(true);
    expect(result.changedKeys).toEqual([]);
  });

  it('counts added and removed keys as changed', () => {
    const result = summarizeSyncInputChanges(
      { 'sync-sources/rules/gone.md': 'r1' },
      { 'sync-sources/templates/new.md': 't1' },
    );

    expect(result.changedKeys).toEqual(['sync-sources/rules/gone.md', 'sync-sources/templates/new.md']);
    expect(result.summary).toBe('1 rule and 1 template changed');
  });

  it('groups dev skills, project inputs, and other sync-sources files', () => {
    const result = summarizeSyncInputChanges(
      {},
      {
        'sync-sources/dev-skills/tool/SKILL.md': 'd1',
        'sync-sources/skills/tool/SKILL.md': 's1',
        'sync-sources/agents/reviewer.md': 'a1',
        'project-skills/myn/deploy/SKILL.md': 'p1',
        'project-skills/myn/deploy/notes.md': 'p2',
        'project-context/myn': 'c1',
        'project-context/overdeck': 'c2',
        'sync-sources/README.md': 'o1',
        'dev-mode': 'm1',
      },
    );

    expect(result.summary).toBe(
      '2 skills, 1 agent definition, 1 project skill, 2 project contexts, 1 other sync-sources file, and dev mode changed',
    );
  });
});
