import { describe, expect, it, vi } from 'vitest';
import { checkMainDivergence } from '../doctor.js';

describe('checkMainDivergence', () => {
  it('emits warn CheckResults with ahead/behind counts past thresholds', async () => {
    const measure = vi.fn(async () => ({ ahead: 2, behind: 1 }));

    const checks = await checkMainDivergence(
      [{ key: 'overdeck', config: { name: 'Overdeck CLI', path: '/repo' } }],
      measure,
    );

    expect(measure).toHaveBeenCalledWith('/repo');
    expect(checks).toEqual([
      {
        name: 'Main Divergence: overdeck (Overdeck CLI)',
        status: 'warn',
        message: 'local main ahead 2, behind 1 relative to origin/main',
        fix: 'Push state commits with `git push origin main`; pan reload builds from origin/main, so stale origin/main can deploy stale code.',
      },
    ]);
  });

  it('emits ok CheckResults when local main is zero-or-one ahead and not behind', async () => {
    const checks = await checkMainDivergence(
      [{ key: 'overdeck', config: { name: 'Overdeck CLI', path: '/repo' } }],
      async () => ({ ahead: 1, behind: 0 }),
    );

    expect(checks).toEqual([
      {
        name: 'Main Divergence: overdeck (Overdeck CLI)',
        status: 'ok',
        message: 'local main ahead 1, behind 0 relative to origin/main',
        fix: undefined,
      },
    ]);
  });
});
