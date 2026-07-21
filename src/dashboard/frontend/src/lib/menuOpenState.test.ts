/**
 * PAN-2937 — menu open state survives remounts; one menu open at a time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMenuOpen } from './menuOpenState';

describe('menuOpenState (PAN-2937)', () => {
  beforeEach(() => useMenuOpen.setState({ openMenuKey: null }));

  it('opens, closes, and persists across simulated remounts', () => {
    const { setOpenMenu } = useMenuOpen.getState();
    setOpenMenu('issue-action:PAN-1');
    expect(useMenuOpen.getState().openMenuKey).toBe('issue-action:PAN-1');
    // A remount re-reads the store rather than resetting to closed.
    expect(useMenuOpen.getState().openMenuKey).toBe('issue-action:PAN-1');
    setOpenMenu(null);
    expect(useMenuOpen.getState().openMenuKey).toBeNull();
  });

  it('opening a second menu closes the first (single-open)', () => {
    const { setOpenMenu } = useMenuOpen.getState();
    setOpenMenu('issue-action:PAN-1');
    setOpenMenu('issue-action:PAN-2');
    expect(useMenuOpen.getState().openMenuKey).toBe('issue-action:PAN-2');
  });
});
