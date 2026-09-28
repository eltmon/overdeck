import { describe, it, expect, beforeEach } from 'vitest';
import { requestLauncherFocusAfterCreate, useLauncherFocusStore } from './launcherFocusStore';

beforeEach(() => useLauncherFocusStore.getState().clear());

describe('launcherFocusStore', () => {
  it('requestLauncherFocusAfterCreate only requests for the command deck', () => {
    requestLauncherFocusAfterCreate('workspace-new', 'widget');
    expect(useLauncherFocusStore.getState().pendingDeckKey).toBeNull();

    requestLauncherFocusAfterCreate('command-deck', 'widget');
    expect(useLauncherFocusStore.getState().pendingDeckKey).toBe('widget');
  });

  it('clear resets the request', () => {
    useLauncherFocusStore.getState().requestFocus('widget');
    useLauncherFocusStore.getState().clear();
    expect(useLauncherFocusStore.getState().pendingDeckKey).toBeNull();
  });
});
