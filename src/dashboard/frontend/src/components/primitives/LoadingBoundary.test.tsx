/**
 * PAN-2908 · C-FRESH — LoadingBoundary tests.
 */
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingBoundary } from './LoadingBoundary';

describe('LoadingBoundary (C-FRESH)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
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

  it('retry restarts the timeout and calls onRetry', () => {
    const onRetry = vi.fn();
    render(<LoadingBoundary label="Tasks" timeoutMs={1000} onRetry={onRetry}><div>spinning…</div></LoadingBoundary>);
    act(() => { vi.advanceTimersByTime(1100); });
    fireEvent.click(screen.getByTestId('loading-boundary-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText('spinning…')).toBeInTheDocument();
  });
});
