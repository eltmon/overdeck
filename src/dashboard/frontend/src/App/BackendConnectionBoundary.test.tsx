import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { BackendConnectionBoundary } from './BackendConnectionBoundary';
import { BACKEND_RECONNECTED_EVENT, BACKEND_RECONNECTING_EVENT } from '../lib/backendConnectionEvents';
import { useMenuOpen } from '../lib/menuOpenState';

function render(ui: ReactNode, queryClient = new QueryClient()) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

describe('BackendConnectionBoundary', () => {
  it('hides the UI, without unmounting it, while the backend is down', () => {
    render(
      <BackendConnectionBoundary backendDown restarting={false}>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    // Hidden, not unmounted: route state such as typed input survives (PAN-3867).
    expect(screen.getByTestId('app-content')).not.toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for backend data');
  });

  it('hides the UI, without unmounting it, while the dashboard is restarting', () => {
    render(
      <BackendConnectionBoundary backendDown={false} restarting>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    // Hidden, not unmounted: route state such as typed input survives (PAN-3867).
    expect(screen.getByTestId('app-content')).not.toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Dashboard is restarting');
  });

  it('keeps child state across an outage and recovery', () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" data-testid="app-content" onClick={() => setCount((c) => c + 1)}>
          {count}
        </button>
      );
    }
    const { rerender } = render(
      <BackendConnectionBoundary backendDown={false} restarting={false}><Counter /></BackendConnectionBoundary>,
    );
    fireEvent.click(screen.getByTestId('app-content'));
    rerender(<BackendConnectionBoundary backendDown restarting={false}><Counter /></BackendConnectionBoundary>);
    rerender(<BackendConnectionBoundary backendDown={false} restarting><Counter /></BackendConnectionBoundary>);
    rerender(<BackendConnectionBoundary backendDown={false} restarting={false}><Counter /></BackendConnectionBoundary>);

    expect(screen.getByTestId('app-content')).toBeVisible();
    expect(screen.getByTestId('app-content')).toHaveTextContent('1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps children mounted with a banner during a transient reconnect', () => {
    render(
      <BackendConnectionBoundary backendDown={false} restarting={false}>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTING_EVENT));
    });
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Connection lost — reconnecting…');

    act(() => {
      window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTED_EVENT));
    });
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('refetches every query when the page is shown again after an outage', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { rerender } = render(
      <BackendConnectionBoundary backendDown={false} restarting={false}><div /></BackendConnectionBoundary>,
      queryClient,
    );
    expect(invalidate).not.toHaveBeenCalled();

    rerender(<BackendConnectionBoundary backendDown restarting={false}><div /></BackendConnectionBoundary>);
    expect(invalidate).not.toHaveBeenCalled();

    rerender(<BackendConnectionBoundary backendDown={false} restarting={false}><div /></BackendConnectionBoundary>);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('closes the open portaled menu when the page is hidden', () => {
    const { rerender } = render(
      <BackendConnectionBoundary backendDown={false} restarting={false}><div /></BackendConnectionBoundary>,
    );
    act(() => useMenuOpen.getState().setOpenMenu('issue-actions:PAN-1'));
    expect(useMenuOpen.getState().openMenuKey).toBe('issue-actions:PAN-1');

    rerender(<BackendConnectionBoundary backendDown restarting={false}><div /></BackendConnectionBoundary>);
    expect(useMenuOpen.getState().openMenuKey).toBeNull();
  });
});
