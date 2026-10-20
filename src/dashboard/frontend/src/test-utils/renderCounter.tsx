/**
 * Render-count test harness (PAN-4560).
 *
 * `createRenderCounter()` counts React `<Profiler>` commits of a named subtree.
 * Mount commits are excluded, so `count(id)` is the number of re-renders after
 * the first render. The store helpers apply events inside `act()` and reset the
 * `useDashboardStore` singleton between tests.
 *
 * Tests built on this harness assert render counts, never `memo` usage: the
 * React Compiler migration (PAN-4561) removes hand-written memoization, and
 * these counts are its safety net.
 */
import { Profiler, type ReactNode } from 'react';
import { act } from '@testing-library/react';
import type { DomainEvent } from '@overdeck/contracts';
import { useDashboardStore, type DashboardState } from '../lib/store';

const initialDashboardState = useDashboardStore.getState();

export function createRenderCounter() {
  const updates = new Map<string, number>();
  function Probe({ id, children }: { id: string; children: ReactNode }) {
    return (
      <Profiler
        id={id}
        onRender={(profilerId, phase) => {
          if (phase === 'mount') return;
          updates.set(profilerId, (updates.get(profilerId) ?? 0) + 1);
        }}
      >
        {children}
      </Profiler>
    );
  }
  return {
    Probe,
    count: (id: string) => updates.get(id) ?? 0,
    counts: () => Object.fromEntries(updates),
    reset: () => updates.clear(),
  };
}

export function applyStoreEvents(events: DomainEvent[]): void {
  act(() => {
    useDashboardStore.getState().applyEvents(events);
  });
}

/** Restores the store to its module-load state, action functions included. */
export function resetDashboardStore(): void {
  useDashboardStore.setState(initialDashboardState, true);
}

export function seedDashboardStore(partial: Partial<DashboardState>): void {
  useDashboardStore.setState(partial);
}
