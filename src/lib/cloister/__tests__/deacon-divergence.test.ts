import { describe, expect, it, vi } from 'vitest';
import { recordMainDivergenceHealth, type DeaconState } from '../deacon.js';

function emptyState(): DeaconState {
  return {
    specialists: {},
    patrolCycle: 1,
    recentDeaths: [],
  };
}

describe('recordMainDivergenceHealth', () => {
  it('records local-main ahead/behind divergence on the health state', async () => {
    const state = emptyState();
    const measure = vi.fn(async () => ({ ahead: 1, behind: 0 }));

    const warnings = await recordMainDivergenceHealth(
      state,
      [{ key: 'overdeck', config: { path: '/repo', name: 'Overdeck' } }],
      measure,
    );

    expect(measure).toHaveBeenCalledWith('/repo');
    expect(warnings).toEqual([]);
    expect(state.mainDivergence).toMatchObject([
      { projectKey: 'overdeck', projectPath: '/repo', ahead: 1, behind: 0 },
    ]);
    expect(state.mainDivergence?.[0]?.checkedAt).toEqual(expect.any(String));
  });

  it('returns warn messages when local main is more than one ahead or any behind', async () => {
    const state = emptyState();
    const warnings = await recordMainDivergenceHealth(
      state,
      [
        { key: 'ahead-project', config: { path: '/ahead' } },
        { key: 'behind-project', config: { path: '/behind' } },
      ],
      async (repoPath) => repoPath === '/ahead'
        ? { ahead: 2, behind: 0 }
        : { ahead: 0, behind: 1 },
    );

    expect(warnings).toEqual([
      'Main divergence for ahead-project: local main ahead 2, behind 0 relative to origin/main',
      'Main divergence for behind-project: local main ahead 0, behind 1 relative to origin/main',
    ]);
  });

  it('records zero divergence when measurement throws a git error', async () => {
    const state = emptyState();
    const warnings = await recordMainDivergenceHealth(
      state,
      [{ key: 'error-project', config: { path: '/error' } }],
      async () => {
        throw new Error('git failed');
      },
    );

    expect(warnings).toEqual([]);
    expect(state.mainDivergence).toMatchObject([
      { projectKey: 'error-project', projectPath: '/error', ahead: 0, behind: 0 },
    ]);
  });
});
