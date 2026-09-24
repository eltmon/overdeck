/**
 * PAN-3925: GET /api/parked derives each project's candidates in parallel,
 * and one project's failure drops only that project's rows.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

vi.mock('../../../../lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/projects.js')>()),
  resolveProjectFromIssueSync: (issueId: string) => {
    const prefix = issueId.split('-')[0];
    return prefix === 'PAN' ? { projectPath: '/repos/overdeck' }
      : prefix === 'MIN' ? { projectPath: '/repos/myn' }
      : null;
  },
}));

const { resolveDerivedParkedRows } = await import('../parked.js');

const state = (issueId: string, value: DerivedIssueState['state']) =>
  ({ issueId, state: value }) as DerivedIssueState;

describe('resolveDerivedParkedRows (PAN-3925)', () => {
  it('starts every project batch before any finishes', async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const loadStates = vi.fn((path: string, ids: readonly string[]) => {
      started.push(path);
      return new Promise<Map<string, DerivedIssueState>>((resolve) => {
        release.push(() => resolve(new Map(ids.map((id) => [id, state(id, 'parked')]))));
      });
    });

    const pending = resolveDerivedParkedRows({ now: () => 0, panes: [], issueIds: ['PAN-1', 'MIN-2'], loadStates });
    await vi.waitFor(() => expect(started.sort()).toEqual(['/repos/myn', '/repos/overdeck']));
    for (const done of release) done();

    const rows = await pending;
    expect(rows.map((row) => [row.issueId, row.orbit]).sort()).toEqual([
      ['MIN-2', 'operator-gate'],
      ['PAN-1', 'operator-gate'],
    ]);
  });

  it('keeps the other projects rows when one project batch fails', async () => {
    const loadStates = vi.fn(async (path: string, ids: readonly string[]) => {
      if (path === '/repos/myn') throw new Error('glab unreachable');
      return new Map(ids.map((id) => [id, state(id, 'parked')]));
    });

    const rows = await resolveDerivedParkedRows({ now: () => 0, panes: [], issueIds: ['PAN-1', 'MIN-2'], loadStates });

    expect(rows.map((row) => row.issueId)).toEqual(['PAN-1']);
  });
});
