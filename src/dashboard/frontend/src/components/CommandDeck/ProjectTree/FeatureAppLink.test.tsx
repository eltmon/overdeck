/** PAN-5649: the app chip offers 'start app' while the app was stopped on purpose or the stack is stopped. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf' }),
}));

import { FeatureAppLink } from './FeatureAppLink';
import type { UatStackSummary } from '../UatStackStatus';
import type { WorkspaceStackHealth } from '../ZoneCOverviewTabs/queries';

const URL = 'https://feature-pan-1.overdeck.localhost';

function summary(state: UatStackSummary['state']): UatStackSummary {
  return { label: state, healthyCount: 1, totalCount: 2, active: true, state };
}

function health(reclaimed?: string[]): WorkspaceStackHealth {
  return { healthy: true, reasons: [], lastObserved: '2026-11-23T00:00:00Z', reclaimed };
}

function renderLink(props: Partial<Parameters<typeof FeatureAppLink>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <FeatureAppLink issueId="PAN-1" frontendUrl={URL} summary={summary('healthy')} {...props} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

let openMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openMock = vi.fn();
  vi.stubGlobal('open', openMock);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FeatureAppLink (PAN-5649)', () => {
  it('offers start app when containers were reclaimed, even with a healthy summary', () => {
    renderLink({ stackHealth: health(['x-frontend-1']) });
    expect(screen.getByTestId('feature-start-app')).toHaveTextContent('start app');
    expect(screen.queryByTestId('feature-open-frontend')).toBeNull();
  });

  it('offers start app for a stopped stack', () => {
    renderLink({ summary: summary('stopped') });
    expect(screen.getByTestId('feature-start-app')).toBeInTheDocument();
  });

  it('keeps the app link for a healthy stack with nothing reclaimed', () => {
    renderLink({ stackHealth: health([]) });
    expect(screen.getByTestId('feature-open-frontend')).toHaveAttribute('href', URL);
    expect(screen.queryByTestId('feature-start-app')).toBeNull();
  });

  it('renders nothing for an unhealthy stack or without a frontend URL', () => {
    renderLink({ summary: summary('unhealthy') });
    expect(screen.queryByTestId('feature-start-app')).toBeNull();
    expect(screen.queryByTestId('feature-open-frontend')).toBeNull();
    cleanup();
    renderLink({ frontendUrl: undefined, stackHealth: health(['x-frontend-1']) });
    expect(screen.queryByTestId('feature-start-app')).toBeNull();
  });

  it('opens the app before posting the wake, shows starting…, then toasts success', async () => {
    let answer: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { invalidate } = renderLink({ stackHealth: health(['x-frontend-1']) });

    fireEvent.click(screen.getByTestId('feature-start-app'));

    expect(openMock).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(openMock.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/PAN-1/wake', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByTestId('feature-start-app')).toHaveTextContent('starting…');
    expect(screen.getByTestId('feature-start-app')).toBeDisabled();

    await act(async () => {
      answer(Response.json({ state: 'started', started: ['x-frontend-1'], alreadyRunning: [], appUrl: URL }));
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Started x-frontend-1'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace', 'PAN-1'] });
    expect(screen.getByTestId('feature-start-app')).toHaveTextContent('start app');
  });

  it('toasts the route error on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })));
    renderLink({ summary: summary('stopped') });
    fireEvent.click(screen.getByTestId('feature-start-app'));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('boom'));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
