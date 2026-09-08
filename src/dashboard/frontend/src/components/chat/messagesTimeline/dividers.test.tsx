import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { WorkingIndicator } from './dividers';

describe('WorkingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('shows elapsed work time and updates while active', () => {
    const { unmount } = render(<WorkingIndicator startedAt="2026-09-08T11:59:50Z" />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Working for 11s')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('Working for 13s')).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
