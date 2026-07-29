import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { operatorInterventionEvent } from '../operator-interventions.js';
import { createWorkspace, upsertProjectFromConfig } from '../workspaces/writer.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../tests/helpers/overdeck-test-db.js';

describe('operatorInterventionEvent', () => {
  it('builds an unsigned operator.intervention domain event', () => {
    expect(operatorInterventionEvent({
      issueId: 'PAN-1',
      kind: 'manual_edit',
      source: 'dashboard:context-layer-save',
      timestamp: '2026-05-25T12:00:00.000Z',
    })).toEqual({
      type: 'operator.intervention',
      timestamp: '2026-05-25T12:00:00.000Z',
      payload: {
        issueId: 'PAN-1',
        kind: 'manual_edit',
        source: 'dashboard:context-layer-save',
      },
    });
  });

  describe('workspaceId (PAN-1990 ac1)', () => {
    let odb: OverdeckTestDb;

    beforeEach(() => {
      odb = setupOverdeckTestDb();
    });

    afterEach(() => {
      teardownOverdeckTestDb(odb);
    });

    it('additively populates workspaceId when a workspace row exists for the issue', async () => {
      upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
      const workspaceId = await createWorkspace({
        projectId: 'overdeck', kind: 'issue', name: 'feature-pan-1', path: join(odb.home, 'feature-pan-1'), issueId: 'PAN-1',
      });

      const event = operatorInterventionEvent({
        issueId: 'PAN-1',
        kind: 'manual_edit',
        source: 'dashboard:context-layer-save',
        timestamp: '2026-05-25T12:00:00.000Z',
      });

      expect((event.payload as { workspaceId?: string }).workspaceId).toBe(workspaceId);
    });

    it('omits workspaceId when no workspace row exists for the issue', () => {
      const event = operatorInterventionEvent({
        issueId: 'PAN-999-NO-WORKSPACE',
        kind: 'manual_edit',
        source: 'dashboard:context-layer-save',
        timestamp: '2026-05-25T12:00:00.000Z',
      });

      expect((event.payload as { workspaceId?: string }).workspaceId).toBeUndefined();
    });
  });
});
