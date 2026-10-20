import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { useState } from 'react';
import type { DomainEvent } from '@overdeck/contracts';
import { useDashboardStore } from '../lib/store';
import {
  applyStoreEvents,
  createRenderCounter,
  resetDashboardStore,
  seedDashboardStore,
} from './renderCounter';

afterEach(() => {
  resetDashboardStore();
});

describe('createRenderCounter', () => {
  it('counts re-renders after mount and excludes the mount commit', () => {
    const counter = createRenderCounter();
    let bump: () => void = () => {};
    function Child() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      return <span>{n}</span>;
    }
    render(
      <counter.Probe id="child">
        <Child />
      </counter.Probe>,
    );
    expect(counter.count('child')).toBe(0);
    act(() => bump());
    act(() => bump());
    expect(counter.count('child')).toBe(2);
    expect(counter.counts()).toEqual({ child: 2 });
    counter.reset();
    expect(counter.count('child')).toBe(0);
  });
});

describe('resetDashboardStore', () => {
  it('restores the initial state and keeps the action functions callable', () => {
    const initialAgents = useDashboardStore.getState().agentsById;
    seedDashboardStore({ bootstrapComplete: true, snapshotTimestamp: '2026-10-19T00:00:00.000Z' });
    expect(useDashboardStore.getState().bootstrapComplete).toBe(true);

    resetDashboardStore();

    const state = useDashboardStore.getState();
    expect(state.bootstrapComplete).toBe(false);
    expect(state.snapshotTimestamp).toBeNull();
    expect(state.agentsById).toBe(initialAgents);
    expect(() => state.applyEvents([])).not.toThrow();
    expect(() => state.openIssue('PAN-1')).not.toThrow();
  });
});

describe('applyStoreEvents', () => {
  it('flushes the renders caused by the events before returning', () => {
    const counter = createRenderCounter();
    function Sequence() {
      return <span data-testid="seq">{useDashboardStore((s) => s.sequence)}</span>;
    }
    const { getByTestId } = render(
      <counter.Probe id="seq">
        <Sequence />
      </counter.Probe>,
    );
    const event = {
      type: 'agent.activity_changed',
      sequence: 7,
      timestamp: '2026-10-19T00:00:00.000Z',
      payload: { agentId: 'agent-pan-1', activity: 'working' },
    } as DomainEvent;

    applyStoreEvents([event]);

    expect(getByTestId('seq').textContent).toBe('7');
    expect(counter.count('seq')).toBe(1);
  });
});
