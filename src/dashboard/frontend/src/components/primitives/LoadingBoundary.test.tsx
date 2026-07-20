/**
 * PAN-2908 · C-FRESH — LoadingBoundary tests.
 */
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingBoundary, resetBoundaryTimers } from './LoadingBoundary';

describe('LoadingBoundary (C-FRESH)', () => {
  beforeEach(() => {
    resetBoundaryTimers();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders children before the timeout', () => {
    render(<LoadingBoundary label="Tasks"><div>Loading tasks…</div></LoadingBoundary>);
    expect(screen.getByText('Loading tasks…')).toBeInTheDocument();
    expect(document.querySelector('[data-component="loading-boundary-unavailable"]')).toBeNull();
  });

  it('replaces the spinner with an explicit unavailable state after the timeout', () => {
    render(<LoadingBoundary label="Tasks" timeoutMs={5000}><div>Loading tasks…</div></LoadingBoundary>);
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByText('Loading tasks…')).toBeNull();
    expect(screen.getByText(/Tasks is taking longer than usual/)).toBeInTheDocument();
  });

  it('does NOT restart the clock on remount (remount-proof)', () => {
    const { unmount } = render(<LoadingBoundary label="Tasks" timeoutMs={5000}><div>a</div></LoadingBoundary>);
    act(() => { vi.advanceTimersByTime(4000); });
    unmount();
    // Remount 4s in — a naive boundary would restart at +8s; this one flips at +5s.
    render(<LoadingBoundary label="Tasks" timeoutMs={5000}><div>b</div></LoadingBoundary>);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.queryByText('b')).toBeNull();
    expect(screen.getByText(/Tasks is taking longer than usual/)).toBeInTheDocument();
  });

  it('retry restarts the timeout and calls onRetry', () => {
    const onRetry = vi.fn();
    render(<LoadingBoundary label="Tasks" timeoutMs={1000} onRetry={onRetry}><div>spinning…</div></LoadingBoundary>);
    act(() => { vi.advanceTimersByTime(1100); });
    fireEvent.click(screen.getByTestId('loading-boundary-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText('spinning…')).toBeInTheDocument();
  });
});
