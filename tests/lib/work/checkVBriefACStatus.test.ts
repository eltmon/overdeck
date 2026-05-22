/**
 * Tests for checkVBriefACStatus pre-flight helper.
 *
 * checkVBriefACStatus wraps getVBriefACStatus and converts its result into
 * failure lines. These tests mock getVBriefACStatus to control the returned
 * value without touching the filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be set up before any import of the module under test
const mockGetVBriefACStatus = vi.fn();
const mockSyncBeadStatusToVBrief = vi.fn();

vi.mock('../../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: mockGetVBriefACStatus,
  syncBeadStatusToVBrief: mockSyncBeadStatusToVBrief,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: vi.fn() };
});

describe('checkVBriefACStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetVBriefACStatus.mockReset();
    mockSyncBeadStatusToVBrief.mockReset();
  });

  it('returns empty array when getVBriefACStatus returns null (no plan)', async () => {
    mockGetVBriefACStatus.mockReturnValue(null);
    const { checkVBriefACStatusSync } = await import('../../../src/lib/work/done-preflight.js');
    expect(checkVBriefACStatusSync('/fake/workspace')).toEqual([]);
  });

  it('returns empty array when all criteria are completed', async () => {
    mockGetVBriefACStatus.mockReturnValue({
      allCompleted: true,
      totalPending: 0,
      totalCount: 2,
      items: [
        {
          itemId: 'item-1',
          itemTitle: 'Feature A',
          pending: 0,
          completed: 2,
          total: 2,
          criteria: [
            { status: 'completed', title: 'AC 1', itemId: 'item-1', itemTitle: 'Feature A' },
            { status: 'completed', title: 'AC 2', itemId: 'item-1', itemTitle: 'Feature A' },
          ],
        },
      ],
    });

    const { checkVBriefACStatusSync } = await import('../../../src/lib/work/done-preflight.js');
    expect(checkVBriefACStatusSync('/fake/workspace')).toEqual([]);
  });

  it('returns failure lines when there are pending acceptance criteria', async () => {
    mockGetVBriefACStatus.mockReturnValue({
      allCompleted: false,
      totalPending: 1,
      totalCount: 2,
      items: [
        {
          itemId: 'item-1',
          itemTitle: 'Feature A',
          pending: 1,
          completed: 1,
          total: 2,
          criteria: [
            { status: 'completed', title: 'AC done', itemId: 'item-1', itemTitle: 'Feature A' },
            { status: 'open', title: 'AC pending', itemId: 'item-1', itemTitle: 'Feature A' },
          ],
        },
      ],
    });

    const { checkVBriefACStatusSync } = await import('../../../src/lib/work/done-preflight.js');
    const result = checkVBriefACStatusSync('/fake/workspace');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatch(/Incomplete acceptance criteria.*1\/2/);
    // Completed criteria should not appear
    expect(result.some((l) => l.includes('AC done'))).toBe(false);
    // Pending criteria should appear
    expect(result.some((l) => l.includes('AC pending'))).toBe(true);
    expect(result.some((l) => l.includes('Feature A'))).toBe(true);
  });

  it('excludes cancelled criteria from the failure list', async () => {
    mockGetVBriefACStatus.mockReturnValue({
      allCompleted: false,
      totalPending: 1,
      totalCount: 3,
      items: [
        {
          itemId: 'item-1',
          itemTitle: 'Feature B',
          pending: 1,
          completed: 2,
          total: 3,
          criteria: [
            { status: 'completed', title: 'Done AC', itemId: 'item-1', itemTitle: 'Feature B' },
            { status: 'cancelled', title: 'Cancelled AC', itemId: 'item-1', itemTitle: 'Feature B' },
            { status: 'open', title: 'Open AC', itemId: 'item-1', itemTitle: 'Feature B' },
          ],
        },
      ],
    });

    const { checkVBriefACStatusSync } = await import('../../../src/lib/work/done-preflight.js');
    const result = checkVBriefACStatusSync('/fake/workspace');
    expect(result.some((l) => l.includes('Cancelled AC'))).toBe(false);
    expect(result.some((l) => l.includes('Open AC'))).toBe(true);
  });

  it('reports pending criteria across multiple items', async () => {
    mockGetVBriefACStatus.mockReturnValue({
      allCompleted: false,
      totalPending: 2,
      totalCount: 4,
      items: [
        {
          itemId: 'item-1',
          itemTitle: 'Feature A',
          pending: 1,
          completed: 1,
          total: 2,
          criteria: [
            { status: 'completed', title: 'A done', itemId: 'item-1', itemTitle: 'Feature A' },
            { status: 'open', title: 'A pending', itemId: 'item-1', itemTitle: 'Feature A' },
          ],
        },
        {
          itemId: 'item-2',
          itemTitle: 'Feature B',
          pending: 1,
          completed: 1,
          total: 2,
          criteria: [
            { status: 'completed', title: 'B done', itemId: 'item-2', itemTitle: 'Feature B' },
            { status: 'open', title: 'B pending', itemId: 'item-2', itemTitle: 'Feature B' },
          ],
        },
      ],
    });

    const { checkVBriefACStatusSync } = await import('../../../src/lib/work/done-preflight.js');
    const result = checkVBriefACStatusSync('/fake/workspace');
    expect(result.some((l) => l.includes('A pending'))).toBe(true);
    expect(result.some((l) => l.includes('Feature A'))).toBe(true);
    expect(result.some((l) => l.includes('B pending'))).toBe(true);
    expect(result.some((l) => l.includes('Feature B'))).toBe(true);
  });

  it('returns empty array when getVBriefACStatus throws', async () => {
    mockGetVBriefACStatus.mockImplementation(() => {
      throw new Error('filesystem error');
    });

    const { checkVBriefACStatusSync } = await import('../../../src/lib/work/done-preflight.js');
    expect(checkVBriefACStatusSync('/fake/workspace')).toEqual([]);
  });
});
