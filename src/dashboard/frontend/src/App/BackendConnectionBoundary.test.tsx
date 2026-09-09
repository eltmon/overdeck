import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BackendConnectionBoundary } from './BackendConnectionBoundary';
import { BACKEND_RECONNECTED_EVENT, BACKEND_RECONNECTING_EVENT } from '../lib/backendConnectionEvents';

describe('BackendConnectionBoundary', () => {
  it('replaces the UI while the backend is down', () => {
    render(
      <BackendConnectionBoundary backendDown restarting={false}>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(screen.queryByTestId('app-content')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for backend data');
  });

  it('replaces the UI while the dashboard is restarting', () => {
    render(
      <BackendConnectionBoundary backendDown={false} restarting>
        <div data-testid="app-content">app</div>
      </BackendConnectionBoundary>,
    );
    expect(screen.queryByTestId('app-content')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Dashboard is restarting');
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
});
