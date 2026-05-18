import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore } from '../store';

describe('DashboardStore drawer slice', () => {
  beforeEach(() => {
    // Reset store to initial state
    const store = useDashboardStore.getState();
    store.closeDrawerIssue();
  });

  it('opens an issue with default tab', () => {
    const store = useDashboardStore.getState();
    store.openDrawerIssue('PAN-1');
    expect(useDashboardStore.getState().drawerIssueId).toBe('PAN-1');
    expect(useDashboardStore.getState().drawerTab).toBe('overview');
  });

  it('opens an issue with explicit tab', () => {
    const store = useDashboardStore.getState();
    store.openDrawerIssue('PAN-1', 'activity');
    expect(useDashboardStore.getState().drawerIssueId).toBe('PAN-1');
    expect(useDashboardStore.getState().drawerTab).toBe('activity');
  });

  it('replaces prior issue when opening a new one (single-instance invariant)', () => {
    const store = useDashboardStore.getState();
    store.openDrawerIssue('PAN-A');
    store.openDrawerIssue('PAN-B');
    expect(useDashboardStore.getState().drawerIssueId).toBe('PAN-B');
  });

  it('closes the drawer', () => {
    const store = useDashboardStore.getState();
    store.openDrawerIssue('PAN-1');
    store.closeDrawerIssue();
    expect(useDashboardStore.getState().drawerIssueId).toBeNull();
    expect(useDashboardStore.getState().drawerTab).toBe('overview');
  });

  it('survives rapid open→close→open burst without orphan state', () => {
    const store = useDashboardStore.getState();
    for (let i = 0; i < 50; i++) {
      store.openDrawerIssue(`PAN-${i}`);
      store.closeDrawerIssue();
    }
    const final = useDashboardStore.getState();
    expect(final.drawerIssueId).toBeNull();
    expect(final.drawerTab).toBe('overview');
  });
});
