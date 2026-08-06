import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { XBriefDocument } from '../../xbrief/types.js';

const planMocks = vi.hoisted(() => ({
  readWorkspacePlan: vi.fn(),
  readWorkspacePlanSync: vi.fn(),
}));

vi.mock('../../xbrief/io.js', () => ({
  readWorkspacePlan: planMocks.readWorkspacePlan,
  readWorkspacePlanSync: planMocks.readWorkspacePlanSync,
}));

import {
  checkIncompletePlanItemsPromise,
  checkIncompletePlanItemsSync,
  evaluateIncompletePlanItems,
} from '../done-preflight.js';

function planWithStatus(
  status: 'pending' | 'completed' | 'cancelled',
  childStatus?: 'pending' | 'completed',
  childId = 'ac1',
): XBriefDocument {
  return {
    xBRIEFInfo: {
      version: '0.8',
      created: '2026-08-01T00:00:00.000Z',
      author: 'overdeck/test',
      description: 'Checklist evaluator fixture',
    },
    plan: {
      id: 'pan-3451',
      title: 'Checklist evaluator fixture',
      status: 'running',
      uid: 'f679e06f-89e2-46df-b60e-c670668135bf',
      author: 'agent:test',
      sequence: 1,
      created: '2026-08-01T00:00:00.000Z',
      updated: '2026-08-01T00:00:00.000Z',
      items: [{
        id: 'item-one',
        title: 'First item',
        status,
        created: '2026-08-01T00:00:00.000Z',
        ...(childStatus ? {
          items: [{
            id: childId,
            title: 'Acceptance criterion',
            status: childStatus,
            metadata: { kind: 'acceptance_criterion' },
          }],
        } : {}),
      }],
      edges: [],
    },
  };
}

beforeEach(() => {
  planMocks.readWorkspacePlan.mockReset();
  planMocks.readWorkspacePlanSync.mockReset();
});

describe('plan checklist evaluation', () => {
  it('uses the asynchronous workspace-plan door for Promise callers', async () => {
    planMocks.readWorkspacePlan.mockReturnValue(Effect.succeed(planWithStatus('pending')));
    planMocks.readWorkspacePlanSync.mockImplementation(() => {
      throw new Error('synchronous plan reader must not run');
    });

    const incomplete = await checkIncompletePlanItemsPromise('/project/workspaces/feature-pan-3451', 'PAN-3451');

    expect(incomplete).toEqual([
      '  Incomplete plan items (1):',
      '    - item-one First item (pending)',
    ]);
    expect(planMocks.readWorkspacePlan).toHaveBeenCalledWith('/project/workspaces/feature-pan-3451');
    expect(planMocks.readWorkspacePlanSync).not.toHaveBeenCalled();
  });

  it('keeps the synchronous reader for synchronous callers', () => {
    planMocks.readWorkspacePlanSync.mockReturnValue(planWithStatus('completed'));

    expect(checkIncompletePlanItemsSync('/project/workspaces/feature-pan-3451')).toEqual([]);
    expect(planMocks.readWorkspacePlanSync).toHaveBeenCalledWith('/project/workspaces/feature-pan-3451');
    expect(planMocks.readWorkspacePlan).not.toHaveBeenCalled();
  });

  it('treats pending children of a cancelled item as satisfied', () => {
    const doc = planWithStatus('completed');
    doc.plan.items = [{
      id: 'cancelled-item',
      title: 'Deliberately deferred',
      status: 'cancelled',
      created: '2026-08-01T00:00:00.000Z',
      items: [{ id: 'ac-1', title: 'Pending acceptance criterion', status: 'pending' }],
    }];

    expect(evaluateIncompletePlanItems(doc)).toEqual([]);
  });

  it('ignores pending acceptance criteria under a cancelled item', () => {
    expect(evaluateIncompletePlanItems(planWithStatus('cancelled', 'pending'))).toEqual([]);
  });

  it('still reports pending acceptance criteria under a completed item without duplicating qualified IDs', () => {
    expect(evaluateIncompletePlanItems(planWithStatus('completed', 'pending', 'item-one.ac1'))).toEqual([
      '  Incomplete plan items (1):',
      '    - item-one.ac1 Acceptance criterion (pending)',
    ]);
  });

  it('reports a missing plan consistently through the shared evaluator', () => {
    expect(evaluateIncompletePlanItems(null)).toEqual([
      '  The required xBRIEF checklist is missing or unreadable; return the issue to planning before completion.',
    ]);
  });
});
