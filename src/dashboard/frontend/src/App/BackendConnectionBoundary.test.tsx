import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { BackendConnectionBoundary } from './BackendConnectionBoundary';
import { useConnectionState, type ConnectionInputs } from '../lib/connectionState';

// PAN-4279 WI-4: degraded mode never hides mounted content; only a tab with no
// snapshot shows the full-page first-load screen.

const LIVE: ConnectionInputs = {
  serverReachable: true,
  streamLive: true,
  restarting: false,
  sessionAuthFailed: false,
  hasSnapshot: true,
  lastLiveAt: 1,
};

function render(ui: ReactNode, queryClient = new QueryClient()) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

function setInputs(inputs: Partial<ConnectionInputs>) {
  act(() => {
    useConnectionState.setState(inputs);
  });
}

function hiddenAncestor(el: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.style.display === 'none') return node;
  }
  return null;
}

function firstLoadScreen() {
  return document.querySelector('[data-component="first-load-screen"]');
}

describe('BackendConnectionBoundary', () => {
  beforeEach(() => {
    useConnectionState.setState({ ...LIVE, reconnect: null });
  });

  it('keeps cached content visible while the server is unreachable', () => {
    useConnectionState.setState({ serverReachable: false });
    render(
      <BackendConnectionBoundary>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    const content = screen.getByTestId('app-content');
    expect(hiddenAncestor(content)).toBeNull();
    expect(content).toBeVisible();
    expect(firstLoadScreen()).toBeNull();
  });

  it('keeps cached content visible while the server restarts', () => {
    useConnectionState.setState({ restarting: true });
    render(
      <BackendConnectionBoundary>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(screen.getByTestId('app-content')).toBeVisible();
    expect(firstLoadScreen()).toBeNull();
  });

  it('shows the first-load screen without a snapshot while unreachable', () => {
    useConnectionState.setState({ hasSnapshot: false, streamLive: false, lastLiveAt: null, serverReachable: false });
    render(
      <BackendConnectionBoundary>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(firstLoadScreen()).not.toBeNull();
    expect(firstLoadScreen()?.textContent).toContain("Can't reach the Overdeck server");
    expect(firstLoadScreen()?.textContent).toContain('The dashboard will load as soon as the server answers.');
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('names a restart on the first-load screen and retries through the connection store', () => {
    const reconnect = vi.fn();
    useConnectionState.setState({ hasSnapshot: false, streamLive: false, lastLiveAt: null, restarting: true, reconnect });
    render(
      <BackendConnectionBoundary>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(firstLoadScreen()?.textContent).toContain('Overdeck server is restarting');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('names a refused session on the first-load screen', () => {
    useConnectionState.setState({ hasSnapshot: false, streamLive: false, lastLiveAt: null, sessionAuthFailed: true });
    render(
      <BackendConnectionBoundary>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(firstLoadScreen()?.textContent).toContain('Dashboard session could not be established');
    expect(firstLoadScreen()?.textContent).toContain('docs/DASHBOARD-AUTH.md');
  });

  it('renders children without a snapshot while only live updates are delayed', () => {
    useConnectionState.setState({ hasSnapshot: false, streamLive: false, lastLiveAt: null });
    render(
      <BackendConnectionBoundary>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(screen.getByTestId('app-content')).toBeVisible();
    expect(firstLoadScreen()).toBeNull();
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
    render(<BackendConnectionBoundary><Counter /></BackendConnectionBoundary>);
    fireEvent.click(screen.getByTestId('app-content'));
    setInputs({ serverReachable: false });
    setInputs({ restarting: true });
    setInputs({ serverReachable: true, restarting: false });

    expect(screen.getByTestId('app-content')).toBeVisible();
    expect(screen.getByTestId('app-content')).toHaveTextContent('1');
  });

  it('refetches every query once the server answers again after an outage', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(<BackendConnectionBoundary><div /></BackendConnectionBoundary>, queryClient);
    expect(invalidate).not.toHaveBeenCalled();

    setInputs({ serverReachable: false });
    expect(invalidate).not.toHaveBeenCalled();

    setInputs({ serverReachable: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('does not refetch on a delayed-only blip', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(<BackendConnectionBoundary><div /></BackendConnectionBoundary>, queryClient);

    setInputs({ streamLive: false });
    setInputs({ streamLive: true });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
