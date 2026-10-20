import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { BackendPane, DomainEvent } from '@overdeck/contracts';
import { selectBackendPanes, useBackendPanes, useDashboardStore } from '../store';
import {
  applyStoreEvents,
  createRenderCounter,
  resetDashboardStore,
  seedDashboardStore,
} from '../../test-utils/renderCounter';

const TIMESTAMP = '2026-10-19T00:00:00.000Z';

function pane(id: string, issue: string, state: BackendPane['state'] = 'working'): BackendPane {
  return { id, issue, role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state };
}

function paneChanged(next: BackendPane, sequence: number): DomainEvent {
  return { type: 'backend_pane.changed', sequence, timestamp: TIMESTAMP, payload: { pane: next } } as DomainEvent;
}

function seedPanes(): void {
  seedDashboardStore({
    backendPanesById: {
      'p-1': pane('p-1', 'PAN-1'),
      'p-2': pane('p-2', 'PAN-2'),
    },
  });
}

afterEach(() => {
  resetDashboardStore();
});

describe('selectBackendPanes', () => {
  it('returns the same array after a pane event for another issue', () => {
    seedPanes();
    const select = selectBackendPanes('PAN-1');
    const before = select(useDashboardStore.getState());
    expect(before.map((p) => p.id)).toEqual(['p-1']);

    applyStoreEvents([paneChanged(pane('p-2', 'PAN-2', 'idle'), 1)]);

    expect(select(useDashboardStore.getState())).toBe(before);
  });

  it('returns a new array after a pane event for this issue', () => {
    seedPanes();
    const select = selectBackendPanes('PAN-1');
    const before = select(useDashboardStore.getState());

    applyStoreEvents([paneChanged(pane('p-1', 'PAN-1', 'idle'), 1)]);

    const after = select(useDashboardStore.getState());
    expect(after).not.toBe(before);
    expect(after[0]?.state).toBe('idle');
  });
});

describe('useBackendPanes', () => {
  it('does not re-render on another issue pane event or a runtime event', () => {
    seedPanes();
    const counter = createRenderCounter();
    function Pan1Panes() {
      const panes = useBackendPanes('PAN-1');
      return <span>{panes.length}</span>;
    }
    render(
      <counter.Probe id="pan1">
        <Pan1Panes />
      </counter.Probe>,
    );

    applyStoreEvents([paneChanged(pane('p-2', 'PAN-2', 'idle'), 1)]);
    applyStoreEvents([
      {
        type: 'agent.activity_changed',
        sequence: 2,
        timestamp: TIMESTAMP,
        payload: { agentId: 'agent-pan-2', activity: 'working', currentTool: 'Read' },
      } as DomainEvent,
    ]);

    expect(counter.count('pan1')).toBe(0);
  });
});
