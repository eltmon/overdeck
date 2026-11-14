import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));

import { PickupGateControls, pickupStageFor, type PickupStage } from '../PickupGateControls';

interface StateOverrides {
  ready?: boolean; planned?: boolean; parked?: boolean; blocksMain?: boolean;
  released?: boolean; objection?: boolean; inSequence?: boolean;
}

function state(overrides: StateOverrides = {}) {
  const { inSequence = false, ...flags } = overrides;
  return {
    issueId: 'PAN-1',
    state: {
      ready: false, planned: false, parked: false, vetoed: false, blocksMain: false,
      inPipeline: false, released: false, objection: false, gate: 'auto',
      ...flags,
    },
    gate: 'auto',
    planning: null,
    inSequence,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(issueState: ReturnType<typeof state> | null, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') return jsonResponse({ success: true });
    if (url.startsWith('/api/backlog/issue-state')) return jsonResponse(issueState ?? {}, status);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderControls(props: { variant?: 'full' | 'strip'; stage?: PickupStage } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PickupGateControls issueId="PAN-1" {...props} />
    </QueryClientProvider>,
  );
}

function labelPosts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === '/api/backlog/sequence/labels' && init?.method === 'POST')
    .map(([, init]) => String(init?.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickupStageFor', () => {
  it.each<[string | undefined, PickupStage]>([
    ['backlog', 'open'],
    ['parked', 'open'],
    ['planned', 'open'],
    ['working', 'picked-up'],
    ['in-review', 'picked-up'],
    ['changes-requested', 'picked-up'],
    ['ready', 'picked-up'],
    ['merged', 'finished'],
    ['closed', 'finished'],
    [undefined, 'open'],
  ])('pickupStageFor maps derived states: %s -> %s', (derived, stage) => {
    expect(pickupStageFor(derived)).toBe(stage);
  });
});

describe('PickupGateControls', () => {
  it('full variant is the default and renders the operator sections', async () => {
    stubFetch(state());
    renderControls();
    expect(await screen.findByText(/Plan → Release · operator \(PAN-2059\)/)).toBeInTheDocument();
    expect(screen.getByText(/Pipeline state · operator controls/)).toBeInTheDocument();
    expect(screen.queryByTestId('drawer-pickup-strip')).toBeNull();
  });

  it('strip shows Release for a planned, unreleased issue and posts released: true', async () => {
    const fetchMock = stubFetch(state({ planned: true }));
    renderControls({ variant: 'strip' });
    fireEvent.click(await screen.findByTestId('pickup-strip-release'));
    await waitFor(() => expect(labelPosts(fetchMock)).toEqual([JSON.stringify({ issueId: 'PAN-1', released: true })]));
  });

  it('strip shows Released and Recall for a released issue and posts released: false', async () => {
    const fetchMock = stubFetch(state({ planned: true, released: true }));
    renderControls({ variant: 'strip' });
    expect(await screen.findByTestId('pickup-strip-released')).toHaveTextContent('Released');
    expect(screen.queryByTestId('pickup-strip-release')).toBeNull();
    fireEvent.click(screen.getByTestId('pickup-strip-recall'));
    await waitFor(() => expect(labelPosts(fetchMock)).toEqual([JSON.stringify({ issueId: 'PAN-1', released: false })]));
  });

  it('strip shows no plan control for an unplanned issue', async () => {
    stubFetch(state());
    renderControls({ variant: 'strip' });
    expect(await screen.findByTestId('drawer-pickup-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('pickup-strip-release')).toBeNull();
    expect(screen.queryByTestId('pickup-strip-recall')).toBeNull();
    expect(screen.queryByTestId('pickup-strip-objection')).toBeNull();
  });

  it('strip at stage picked-up shows the chips and no plan control', async () => {
    stubFetch(state({ planned: true }));
    renderControls({ variant: 'strip', stage: 'picked-up' });
    expect(await screen.findByTestId('pickup-strip-ready')).toBeInTheDocument();
    expect(screen.getByTestId('pickup-strip-blocksMain')).toBeInTheDocument();
    expect(screen.getByTestId('pickup-strip-parked')).toBeInTheDocument();
    expect(screen.getByTestId('pickup-strip-more')).toBeInTheDocument();
    expect(screen.queryByTestId('pickup-strip-release')).toBeNull();
  });

  it('strip toggles Ready through the labels route', async () => {
    const fetchMock = stubFetch(state());
    renderControls({ variant: 'strip' });
    const chip = await screen.findByTestId('pickup-strip-ready');
    expect(chip).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(chip);
    await waitFor(() => expect(labelPosts(fetchMock)).toEqual(['{"issueId":"PAN-1","ready":true}']));
    expect(screen.getByTestId('pickup-strip-ready')).toHaveAttribute('aria-checked', 'true');
  });

  it('strip shows the Objection chip instead of Release and opens the full controls', async () => {
    stubFetch(state({ planned: true, objection: true }));
    renderControls({ variant: 'strip' });
    fireEvent.click(await screen.findByTestId('pickup-strip-objection'));
    expect(screen.queryByTestId('pickup-strip-release')).toBeNull();
    expect(within(screen.getByTestId('pickup-strip-popover')).getByText('Override → Plan anyway')).toBeInTheDocument();
  });

  it('the sliders button opens the full controls and Escape closes them', async () => {
    stubFetch(state());
    renderControls({ variant: 'strip' });
    fireEvent.click(await screen.findByTestId('pickup-strip-more'));
    const popover = screen.getByTestId('pickup-strip-popover');
    expect(within(popover).getByText(/Pipeline state · operator controls/)).toBeInTheDocument();
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByTestId('pickup-strip-popover')).toBeNull();
  });

  it('Escape on the sliders button closes the popover and is marked handled', async () => {
    stubFetch(state());
    renderControls({ variant: 'strip' });
    const more = await screen.findByTestId('pickup-strip-more');
    fireEvent.click(more);
    expect(screen.getByTestId('pickup-strip-popover')).toBeInTheDocument();
    const event = createEvent.keyDown(more, { key: 'Escape' });
    fireEvent(more, event);
    expect(screen.queryByTestId('pickup-strip-popover')).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('strip at stage finished renders nothing and does not request the issue state', () => {
    const fetchMock = stubFetch(state());
    const { container } = renderControls({ variant: 'strip', stage: 'finished' });
    expect(container.innerHTML).toBe('');
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/backlog/issue-state'))).toEqual([]);
  });

  it('strip renders only the sliders button when the state fails to load', async () => {
    stubFetch(null, 500);
    renderControls({ variant: 'strip' });
    const more = await screen.findByTestId('pickup-strip-more');
    expect(more).toHaveAttribute('title', 'Pickup state unavailable');
    expect(screen.queryByTestId('pickup-strip-ready')).toBeNull();
    fireEvent.click(more);
    expect(within(screen.getByTestId('pickup-strip-popover')).getByText('Error: HTTP 500')).toBeInTheDocument();
  });
});
