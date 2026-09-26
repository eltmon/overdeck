/**
 * PAN-4223 WI-18: builder ↔ critic pairing by iteration (D25).
 */
import { describe, expect, it } from 'vitest';

import { criticChain, formatCriticChain, judgedIteration, pairBuilder, type PairingRow } from '../pairing.js';

let minute = 0;
function row(id: number, overrides: Partial<PairingRow>): PairingRow {
  minute += 1;
  return {
    id,
    name: `r${id}`,
    run: 'hotel',
    key: '663',
    role: 'builder',
    iteration: 1,
    createdAt: new Date(Date.parse('2026-09-26T10:00:00.000Z') + minute * 60_000).toISOString(),
    criticOfId: null,
    activity: 'stopped',
    report: null,
    ...overrides,
  };
}

const done = (value: 'WOWED' | 'NOT_YET' | 'PASS' | 'DEFECTS', defects: number | null = null) =>
  ({ status: 'done' as const, verdict: { value, defects, file: null } });

describe('pairing (PAN-4223 WI-18)', () => {
  it('renders the example chain exactly', () => {
    const i1 = row(1, { report: { status: 'done' } });
    const c1 = row(2, { role: 'critic', criticOfId: 1, report: done('NOT_YET', 7) });
    const i2 = row(3, { iteration: 2, report: { status: 'done' } });
    const c2 = row(4, { role: 'critic', iteration: 2, criticOfId: 3, report: done('WOWED') });
    expect(formatCriticChain(criticChain('hotel', '663', [i1, c1, i2, c2])))
      .toBe('i1 built → critic c1: NOT_YET (7 defects) → i2 built → critic c2: WOWED');
  });

  it('shares i1 critics between a builder and its --reuse respawn', () => {
    const first = row(1, {});
    const respawn = row(2, {});
    const critic = row(3, { role: 'critic', criticOfId: 1, report: done('PASS', 1) });
    expect(pairBuilder(respawn, [first, respawn, critic]).critics.map((c) => c.id)).toEqual([3]);
    const [step] = criticChain('hotel', '663', [first, respawn, critic]);
    expect(step).toMatchObject({ kind: 'builder', iteration: 1, ids: [1, 2] });
    expect(formatCriticChain(criticChain('hotel', '663', [first, respawn, critic]))).toBe('i1 stopped → critic c1: PASS (1 defect)');
  });

  it('reads a critic whose newest report is blocked as pending', () => {
    const builder = row(1, {});
    const critic = row(2, { role: 'critic', criticOfId: 1, activity: 'idle', report: { status: 'blocked' } });
    expect(pairBuilder(builder, [builder, critic]).latestVerdict).toMatchObject({ verdict: 'pending', defects: null, activity: 'idle' });
  });

  it('answers the newest i1 critic created before the i2 row, and nothing for i1', () => {
    const i1 = row(1, {});
    const early = row(2, { role: 'critic', criticOfId: 1, report: done('NOT_YET', 3) });
    const i2 = row(3, { iteration: 2 });
    const late = row(4, { role: 'critic', criticOfId: 1, report: done('WOWED') });
    const rows = [i1, early, i2, late];
    expect(pairBuilder(i2, rows).answering).toMatchObject({ id: 2, verdict: 'NOT_YET', iteration: 1 });
    expect(pairBuilder(i1, rows).answering).toBeNull();
  });

  it('labels a verifier v<n> and drops a critic whose linked row is absent', () => {
    const builder = row(1, {});
    const verifier = row(2, { role: 'verifier', criticOfId: 1, report: done('DEFECTS', 2) });
    const stray = row(3, { role: 'critic', criticOfId: 99 });
    const rows = [builder, verifier, stray];
    expect(pairBuilder(builder, rows).critics).toEqual([expect.objectContaining({ id: 2, role: 'verifier' })]);
    expect(formatCriticChain(criticChain('hotel', '663', rows))).toBe('i1 stopped → verifier v1: DEFECTS (2 defects)');
    expect(judgedIteration(stray, new Map(rows.map((r) => [r.id, r])))).toBeNull();
  });
});
