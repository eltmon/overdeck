/**
 * PAN-5364: the pure board-section selectors — outcome hero, folded rebuilds,
 * covered voided batches, identical runs and the three-row cap.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBatchSections,
  capOlderRows,
  pickOutcomeBatch,
  type OlderRow,
} from '../batchSections';
import type { UatGenerationPayload } from '../boardTypes';
import { REPORTED_MERGED_AT, gen, member, reportedChain } from './fixtures';

const SHORT = 'uat/pan-train-moss-1115-';
const names = (gens: readonly UatGenerationPayload[]) => gens.map((g) => g.name);
const rowNames = (rows: readonly OlderRow[]) => rows.map((row) => (row.kind === 'single' ? row.gen.name : names(row.gens)));
const plusSeconds = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();

function promoted(name: string, members: UatGenerationPayload['members'], promotedAt: string, createdAt: string): UatGenerationPayload {
  return gen({
    name, status: 'promoted', members, createdAt, updatedAt: promotedAt,
    repos: [{ repoKey: 'overdeck', branch: name, baseSha: 'b', targetBranch: 'main', mergeOrder: 1, promotedAt, mergeSha: 'abc1234def' }],
  });
}

describe('buildBatchSections', () => {
  it('the reported chain: merged -11 is the outcome, -12 and -10 fold under it, -3..-9 are covered', () => {
    const sections = buildBatchSections(reportedChain());
    expect(sections.hero).toBeNull();
    expect(sections.outcome?.name).toBe(`${SHORT}11`);
    expect(names(sections.folded)).toEqual([`${SHORT}12`, `${SHORT}10`]);
    expect(sections.rows).toEqual([]);
    expect(sections.covered).toHaveLength(1);
    const run = sections.covered[0]!;
    expect(run.kind).toBe('run');
    expect(run.kind === 'run' && names(run.gens)).toEqual([9, 8, 7, 6, 5, 4, 3].map((n) => `${SHORT}${n}`));
  });

  it('legacy rows without voidedBy: the outcome still shows and the siblings are covered', () => {
    const chain = reportedChain().map((g) => ({ ...g, voidedBy: null }));
    chain[0] = { ...chain[0]!, updatedAt: plusSeconds(REPORTED_MERGED_AT, 5) };
    const sections = buildBatchSections(chain);
    expect(sections.outcome?.name).toBe(`${SHORT}11`);
    expect(sections.folded).toEqual([]);
    const covered = sections.covered.flatMap((row) => (row.kind === 'single' ? [row.gen] : row.gens));
    expect(names(covered)).toEqual(expect.arrayContaining([`${SHORT}12`, `${SHORT}10`]));
    expect(sections.rows).toEqual([]);
  });

  it('a stack heal on an old voided batch after the merge does not hide the outcome', () => {
    const chain = reportedChain().map((g) => (g.name === `${SHORT}5`
      ? { ...g, updatedAt: plusSeconds(REPORTED_MERGED_AT, 600) }
      : g));
    expect(pickOutcomeBatch(chain)?.name).toBe(`${SHORT}11`);
    expect(buildBatchSections(chain).outcome?.name).toBe(`${SHORT}11`);
  });

  it('a failed batch created after the merge means no outcome hero', () => {
    const p = promoted('uat/p', [member('PAN-1')], '2026-11-15T10:00:00.000Z', '2026-11-15T09:50:00.000Z');
    const f = gen({ name: 'uat/f', status: 'failed', members: [member('PAN-2')], createdAt: '2026-11-15T10:05:00.000Z', updatedAt: '2026-11-15T10:06:00.000Z' });
    expect(pickOutcomeBatch([f, p])).toBeNull();
    const sections = buildBatchSections([f, p]);
    expect(sections.outcome).toBeNull();
    expect(sections.rows[0]).toEqual({ kind: 'single', gen: f });
  });

  it('a live batch is the hero; the outcome is null', () => {
    const r = gen({ name: 'uat/r', status: 'ready', createdAt: '2026-11-15T11:00:00.000Z' });
    const p = promoted('uat/p', [member('PAN-1')], '2026-11-15T10:00:00.000Z', '2026-11-15T09:50:00.000Z');
    const sections = buildBatchSections([r, p]);
    expect(sections.hero).toBe(r);
    expect(sections.outcome).toBeNull();
  });

  it('identical voided rebuilds with no covering merge collapse into one run', () => {
    const r = gen({ name: 'uat/r', status: 'ready', members: [member('PAN-A')] });
    const voided = Array.from({ length: 8 }, (_, i) => gen({
      name: `uat/v-${8 - i}`, status: 'invalidated', members: [member('pan-b', 1), member('PAN-C', 2)],
    }));
    const sections = buildBatchSections([r, ...voided]);
    expect(sections.hero).toBe(r);
    expect(sections.rows).toEqual([{ kind: 'run', gens: voided }]);
    expect(sections.covered).toEqual([]);
  });

  it('superseded and failed batches are never folded, covered or collapsed', () => {
    const members = [member('PAN-1'), member('PAN-2', 2)];
    const p = promoted('uat/p', members, '2026-11-15T10:00:00.000Z', '2026-11-15T09:50:00.000Z');
    const failed = [1, 2].map((n) => gen({
      name: `uat/f-${n}`, status: 'failed', members, voidedBy: 'uat/p',
      createdAt: `2026-11-15T09:4${n}:00.000Z`, updatedAt: `2026-11-15T09:4${n}:30.000Z`,
    })).reverse();
    const afterMerge = buildBatchSections([p, ...failed]);
    expect(afterMerge.outcome).toBe(p);
    expect(afterMerge.folded).toEqual([]);
    expect(afterMerge.covered).toEqual([]);
    expect(rowNames(afterMerge.rows)).toEqual(['uat/f-2', 'uat/f-1']);

    const r = gen({ name: 'uat/r', status: 'ready', members: [member('PAN-9')], createdAt: '2026-11-15T11:00:00.000Z' });
    const superseded = [1, 2].map((n) => gen({
      name: `uat/s-${n}`, status: 'superseded', members, createdAt: `2026-11-15T09:3${n}:00.000Z`,
    })).reverse();
    const live = buildBatchSections([r, p, ...superseded]);
    expect(live.hero).toBe(r);
    expect(live.covered).toEqual([]);
    expect(rowNames(live.rows)).toEqual(['uat/p', 'uat/s-2', 'uat/s-1']);
  });
});

describe('capOlderRows', () => {
  it('cap keeps three rows and every failed single', () => {
    const rows: OlderRow[] = [1, 2, 3, 4].map((n) => ({ kind: 'single' as const, gen: gen({ name: `uat/v-${n}`, status: 'invalidated' }) }));
    rows.push({ kind: 'single', gen: gen({ name: 'uat/f-5', status: 'failed' }) });
    const capped = capOlderRows(rows, false);
    expect(rowNames(capped.shown)).toEqual(['uat/v-1', 'uat/v-2', 'uat/v-3', 'uat/f-5']);
    expect(capped.hiddenCount).toBe(1);
    expect(capOlderRows(rows, true)).toEqual({ shown: rows, hiddenCount: 0 });
  });
});
