import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { GauntletRunFeedCard } from '../GauntletRunFeedCard';
import type { GauntletRunLane, GauntletRunSessionFeedEntry } from '../types';

const now = new Date('2026-09-28T12:00:00.000Z');

let queryClients: QueryClient[] = [];

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(client);
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function lane(name: string, overrides: Partial<GauntletRunLane> = {}): GauntletRunLane {
  return {
    id: Number(name.replace(/\D/g, '')) || 1,
    name,
    key: 'alpha',
    role: 'builder',
    iteration: 1,
    activity: 'working',
    report: null,
    criticOfConversationId: null,
    createdAt: '2026-09-28T11:00:00.000Z',
    ...overrides,
  };
}

function runEntry(overrides: Partial<GauntletRunSessionFeedEntry> = {}): GauntletRunSessionFeedEntry {
  return {
    kind: 'gauntlet_run',
    id: 'gauntlet-run:lexerra:india',
    timestamp: '2026-09-28T11:55:00.000Z',
    workspaceId: null,
    issueId: null,
    run: 'india',
    projectKey: 'lexerra',
    orchestratorName: 'conv-2884',
    orchestratorTitle: 'Lexerra gauntlet',
    countsLine: '1 builder · 1 critic · 2 working',
    state: 'working',
    latest: { text: 'alpha critic i1 reported done · verdict pass', at: '2026-09-28T11:55:00.000Z' },
    lanes: [
      lane('conv-lane-1'),
      lane('conv-lane-2', { role: 'critic', criticOfConversationId: 1, report: { status: 'done', at: '2026-09-28T11:55:00.000Z', verdict: 'pass' } }),
    ],
    laneConversationIds: [1, 2],
    anyAlive: true,
    ...overrides,
  };
}

function laneDetail(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    projectKey: 'lexerra',
    archived: false,
    key: 'alpha',
    role: 'builder',
    git: { branch: 'gauntlet/india-alpha', head: '0123456789abcdef', ahead: 2, dirty: true },
    ...overrides,
  };
}

afterEach(async () => {
  cleanup();
  await Promise.all(queryClients.map((client) => client.cancelQueries()));
  queryClients.forEach((client) => client.clear());
  queryClients = [];
  vi.unstubAllGlobals();
});

describe('GauntletRunFeedCard', () => {
  it('renders the collapsed card without lane rows', () => {
    const fetchControl = installStrictFetchMock(() => undefined);

    render(<GauntletRunFeedCard entry={runEntry()} onSelect={vi.fn()} now={now} />);

    expect(screen.getByText('INDIA · lexerra')).toBeTruthy();
    expect(screen.getByText('1 builder · 1 critic · 2 working')).toBeTruthy();
    expect(screen.getByText('latest: alpha critic i1 reported done · verdict pass')).toBeTruthy();
    expect(screen.getByText('launched from Lexerra gauntlet')).toBeTruthy();
    expect(screen.queryByTestId('gauntlet-run-lane-conv-lane-1')).toBeNull();
    expect(fetchControl.fetchMock).not.toHaveBeenCalled();
  });

  it('calls onSelect with the entry id from the main area', () => {
    installStrictFetchMock(() => undefined);
    const onSelect = vi.fn();

    render(<GauntletRunFeedCard entry={runEntry()} onSelect={onSelect} now={now} />);
    fireEvent.click(screen.getByText('INDIA · lexerra'));

    expect(onSelect).toHaveBeenCalledWith('gauntlet-run:lexerra:india');
  });

  it('expands to one row per lane and fetches lane details exactly once', async () => {
    const fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/lanes?run=india') {
        return Response.json({ generatedAt: now.toISOString(), lanes: [laneDetail('conv-lane-1'), laneDetail('conv-lane-2', { git: null })] });
      }
      return undefined;
    });

    render(<GauntletRunFeedCard entry={runEntry()} onSelect={vi.fn()} now={now} />);
    fireEvent.click(screen.getByTestId('gauntlet-run-expand'));

    expect(screen.getByTestId('gauntlet-run-lane-conv-lane-1').textContent).toContain('alpha i1 · working');
    expect(screen.getByTestId('gauntlet-run-lane-conv-lane-2').textContent).toContain('alpha i1 · working · done · pass');
    expect(screen.getByTestId('gauntlet-run-lane-conv-lane-2').className).toContain('pl-3');
    expect(await screen.findByText('gauntlet/india-alpha@01234567 +2 dirty')).toBeTruthy();

    fireEvent.click(screen.getByTestId('gauntlet-run-expand'));
    expect(screen.queryByTestId('gauntlet-run-lane-conv-lane-1')).toBeNull();
    fireEvent.click(screen.getByTestId('gauntlet-run-expand'));
    expect(screen.getByTestId('gauntlet-run-lane-conv-lane-1')).toBeTruthy();

    expect(fetchControl.fetchMock).toHaveBeenCalledTimes(1);
    await fetchControl.assertNoUnexpectedRequests();
  });

  it('shows only lanes of the card project, and archived ones under a muted label', async () => {
    installStrictFetchMock(({ url }) => {
      if (url === '/api/lanes?run=india') {
        return Response.json({
          generatedAt: now.toISOString(),
          lanes: [
            laneDetail('conv-lane-1'),
            laneDetail('conv-other-9', { projectKey: 'overdeck', archived: true, key: 'zulu' }),
            laneDetail('conv-old-7', { archived: true, key: 'bravo', git: null }),
          ],
        });
      }
      return undefined;
    });

    render(<GauntletRunFeedCard entry={runEntry()} onSelect={vi.fn()} now={now} />);
    fireEvent.click(screen.getByTestId('gauntlet-run-expand'));

    expect(await screen.findByTestId('gauntlet-run-archived-conv-old-7')).toBeTruthy();
    expect(screen.getByText('archived')).toBeTruthy();
    expect(screen.queryByTestId('gauntlet-run-archived-conv-other-9')).toBeNull();
    expect(screen.queryByText(/zulu/)).toBeNull();
  });

  it('keeps lane rows and says details are unavailable when the fetch fails', async () => {
    installStrictFetchMock(({ url }) => (url === '/api/lanes?run=india' ? new Response('boom', { status: 500 }) : undefined));

    render(<GauntletRunFeedCard entry={runEntry()} onSelect={vi.fn()} now={now} />);
    fireEvent.click(screen.getByTestId('gauntlet-run-expand'));

    expect(await screen.findByText('Lane details unavailable')).toBeTruthy();
    expect(screen.getByTestId('gauntlet-run-lane-conv-lane-1')).toBeTruthy();
  });

  it('navigates a lane row to its conversation', () => {
    installStrictFetchMock(({ url }) => (url === '/api/lanes?run=india' ? Response.json({ generatedAt: now.toISOString(), lanes: [] }) : undefined));
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<GauntletRunFeedCard entry={runEntry()} onSelect={vi.fn()} now={now} />);
    fireEvent.click(screen.getByTestId('gauntlet-run-expand'));
    fireEvent.click(screen.getByTestId('gauntlet-run-lane-conv-lane-2'));

    expect(pushState).toHaveBeenCalledWith(null, '', '/conv/conv-lane-2');
    pushState.mockRestore();
  });
});
