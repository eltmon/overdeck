/**
 * PAN-5364: board chain selection — 24-hour age-out for voided, merged and old
 * failed batches, live batches always kept, and the newest merge always shown.
 * `now` is passed explicitly; no wall-clock time.
 */

import { describe, expect, it } from 'vitest';
import type { UatGeneration, UatGenerationStatus } from '../../../../lib/overdeck/merge-types.js';
import { generationMergedAt, selectBoardChain } from '../uat-board-chain.js';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const hoursAgo = (h: number): string => new Date(NOW - h * HOUR).toISOString();

function gen(
  name: string,
  status: UatGenerationStatus,
  ageHours: number,
  overrides: Partial<UatGeneration> = {},
): UatGeneration {
  return {
    name,
    worktreePath: `/proj/workspaces/${name.replace('/', '-')}`,
    projectRoot: '/proj',
    baseSha: 'main-sha',
    status,
    members: [],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    cleanedAt: null,
    createdAt: hoursAgo(ageHours),
    updatedAt: hoursAgo(ageHours),
    ...overrides,
  };
}

function promotedRepo(promotedAt: string | null): NonNullable<UatGeneration['repos']>[number] {
  return {
    repoKey: 'overdeck',
    repoPath: '/proj',
    branch: 'uat/x',
    baseSha: 'main-sha',
    targetBranch: 'main',
    worktreePath: '/proj/workspaces/uat',
    mergeOrder: 1,
    promotedAt,
  };
}

const names = (rows: UatGeneration[]): string[] => rows.map((g) => g.name);

describe('selectBoardChain', () => {
  it('drops a voided batch older than 24 hours and keeps one 23 hours old', () => {
    const chain = [gen('uat/kept', 'invalidated', 23), gen('uat/dropped', 'invalidated', 25)];
    expect(names(selectBoardChain(chain, NOW))).toEqual(['uat/kept']);
  });

  it('ages a promoted batch by its merge time, not updatedAt', () => {
    const merged = gen('uat/merged', 'promoted', 30, {
      updatedAt: hoursAgo(1),
      repos: [promotedRepo(hoursAgo(25))],
    });
    expect(generationMergedAt(merged)).toBe(hoursAgo(25));
    expect(selectBoardChain([merged], NOW)).toEqual([]);
  });

  it('keeps ready, superseded and assembling batches at any age', () => {
    const month = 30 * 24;
    const chain = [
      gen('uat/assembling', 'assembling', month),
      gen('uat/ready', 'ready', month),
      gen('uat/superseded', 'superseded', month),
    ];
    expect(names(selectBoardChain(chain, NOW))).toEqual(['uat/assembling', 'uat/ready', 'uat/superseded']);
  });

  it('keeps an old failed batch only when it is the newest row', () => {
    expect(names(selectBoardChain([gen('uat/failed', 'failed', 72)], NOW))).toEqual(['uat/failed']);
    const chain = [gen('uat/voided', 'invalidated', 48), gen('uat/failed', 'failed', 72)];
    expect(selectBoardChain(chain, NOW)).toEqual([]);
  });

  it('appends the newest promoted batch after ten newer rows', () => {
    const voided = Array.from({ length: 12 }, (_, i) => gen(`uat/voided-${i}`, 'invalidated', 1 + i * 0.1));
    const merged = gen('uat/merged', 'promoted', 3, { repos: [promotedRepo(hoursAgo(3))] });
    const result = selectBoardChain([...voided, merged], NOW);
    expect(result).toHaveLength(11);
    expect(names(result.slice(0, 10))).toEqual(names(voided.slice(0, 10)));
    expect(result[10]).toBe(merged);
  });

  it('returns rows newest createdAt first when nothing is appended', () => {
    const chain = [
      gen('uat/c', 'ready', 1),
      gen('uat/b', 'invalidated', 2),
      gen('uat/a', 'promoted', 3, { repos: [promotedRepo(hoursAgo(3))] }),
    ];
    const result = selectBoardChain(chain, NOW);
    expect(names(result)).toEqual(['uat/c', 'uat/b', 'uat/a']);
    const created = result.map((g) => Date.parse(g.createdAt));
    expect([...created].sort((x, y) => y - x)).toEqual(created);
  });

  it('keeps a row whose timestamp does not parse', () => {
    const chain = [gen('uat/odd', 'invalidated', 1, { updatedAt: 'not-a-date' })];
    expect(names(selectBoardChain(chain, NOW))).toEqual(['uat/odd']);
  });
});
