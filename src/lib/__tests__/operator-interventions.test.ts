import { describe, expect, it } from 'vitest';
import { operatorInterventionEvent } from '../operator-interventions.js';

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
});
