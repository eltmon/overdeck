/**
 * Tests for PAN-503: PlanDialog must continue rendering XTerminal (not ActivityView)
 * for live planning sessions. This guards against regressions from the
 * TerminalPanel/AgentOutputPanel changes that route planning agents to ActivityView.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Issue } from '../types';
import { PlanDialog } from './PlanDialog';

// Lightweight mocks for heavy child components
vi.mock('./XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterm" data-session={sessionName} />
  ),
}));

vi.mock('./CommandDeck/ActivityView', () => ({
  ActivityView: ({ issueId }: { issueId: string }) => (
    <div data-testid="activity-view" data-issue={issueId} />
  ),
}));

vi.mock('./TasksPanel', () => ({
  TasksPanel: () => <div data-testid="tasks-tasks-panel" />,
}));

vi.mock('./PlanSetupScreen', () => ({
  PlanSetupScreen: () => <div data-testid="plan-setup-screen" />,
}));

vi.mock('./DialogProvider', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/store', () => ({
  useDashboardStore: () => ({ agents: [], issues: [] }),
}));

vi.mock('react-rnd', () => ({
  Rnd: ({ children }: { children: React.ReactNode }) => <div data-testid="rnd">{children}</div>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const MOCK_ISSUE: Issue = {
  id: 'issue-pan-503',
  identifier: 'PAN-503',
  title: 'Planning agent: ActivityView in detail pane',
  description: '',
  status: 'In Planning',
  priority: 2,
  labels: [],
  url: 'https://github.com/test/test/issues/503',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: 'github',
};

function makeFetchMock(sessionName = 'planning-pan-503', active = true, harness?: string) {
  return vi.fn((url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('/api/planning/') && urlStr.includes('/status')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            active,
            sessionName,
            hasPromptFile: true,
            hasStateFile: false,
            hasCompletionMarker: false,
          }),
      } as Response);
    }
    if (urlStr.includes('/api/settings/available-models')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }
    if (urlStr.includes('/api/settings')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          workhorses: { expensive: 'claude-opus-4-7' },
          roles: { plan: { model: 'workhorse:expensive', harness } },
        }),
      } as Response);
    }
    if (urlStr.includes('/api/issues/') && urlStr.includes('/start-planning')) {
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      } as unknown as Response);
    }
    // Any other fetch → 404
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
  });
}

function renderPlanDialog(isOpen = true, issue: Issue = MOCK_ISSUE) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanDialog
        issue={issue}
        isOpen={isOpen}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    </QueryClientProvider>
  );
}

/**
 * PAN-4198 (D8): the dialog no longer takes an `autoStart` prop that clicked a
 * button for the operator. Automatic planning is the operator pressing
 * "Plan automatically".
 */
async function clickPlanAutomatically() {
  const button = await screen.findByRole('button', { name: /Plan automatically/ });
  fireEvent.click(button);
}

function startPlanningBody(fetchMock: ReturnType<typeof makeFetchMock>) {
  const startCall = fetchMock.mock.calls.find(([url]) => url.toString().includes('/start-planning'));
  expect(startCall).toBeTruthy();
  return JSON.parse((startCall?.[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('PlanDialog — XTerminal rendering', () => {
  beforeEach(() => {
    global.fetch = makeFetchMock() as unknown as typeof fetch;
  });

  it('renders XTerminal when planning session is active', async () => {
    renderPlanDialog();

    await waitFor(() => {
      expect(screen.getByTestId('xterm')).toBeInTheDocument();
    });
  });

  it('shows the planning session name in XTerminal', async () => {
    renderPlanDialog();

    await waitFor(() => {
      const xterm = screen.getByTestId('xterm');
      expect(xterm).toHaveAttribute('data-session', 'planning-pan-503');
    });
  });

  it('does NOT render ActivityView during an active planning session', async () => {
    renderPlanDialog();

    await waitFor(() => {
      expect(screen.getByTestId('xterm')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('activity-view')).not.toBeInTheDocument();
  });

  it('offers both start buttons in plain language (PAN-4198 D12)', async () => {
    global.fetch = makeFetchMock('planning-pan-503', false) as unknown as typeof fetch;

    renderPlanDialog(true, { ...MOCK_ISSUE, status: 'Todo' });

    expect(await screen.findByRole('button', { name: /Plan with me/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plan automatically/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Auto-plan$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start Planning$/ })).not.toBeInTheDocument();
  });

  it('sends auto=true when the operator chooses Plan automatically', async () => {
    const fetchMock = makeFetchMock('planning-pan-503', false);
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPlanDialog(true, { ...MOCK_ISSUE, status: 'Todo' });
    await clickPlanAutomatically();

    await waitFor(() => expect(startPlanningBody(fetchMock)).toMatchObject({ auto: true }));
  });

  it('leaves autoStart false until the start-after-planning box is checked (PAN-4198 FR-7)', async () => {
    const fetchMock = makeFetchMock('planning-pan-503', false);
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPlanDialog(true, { ...MOCK_ISSUE, status: 'Todo' });
    await clickPlanAutomatically();

    await waitFor(() => expect(startPlanningBody(fetchMock)).toMatchObject({ autoStart: false }));
  });

  it('sends autoStart=true when start-after-planning is checked', async () => {
    const fetchMock = makeFetchMock('planning-pan-503', false);
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPlanDialog(true, { ...MOCK_ISSUE, status: 'Todo' });
    fireEvent.click(await screen.findByLabelText(/Start work as soon as the plan is ready/));
    await clickPlanAutomatically();

    await waitFor(() => expect(startPlanningBody(fetchMock)).toMatchObject({ auto: true, autoStart: true }));
  });

  it.each(['muse', 'kimi-code'])('uses the configured %s planning harness', async harness => {
    const fetchMock = makeFetchMock('planning-pan-503', false, harness);
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPlanDialog(true, { ...MOCK_ISSUE, status: 'Todo' });
    await clickPlanAutomatically();

    await waitFor(() => expect(startPlanningBody(fetchMock)).toMatchObject({ harness }));
  });

  it('shows the plan role model from settings as the default model', async () => {
    global.fetch = makeFetchMock('planning-pan-503', false) as unknown as typeof fetch;

    renderPlanDialog(true, { ...MOCK_ISSUE, status: 'Todo' });

    expect(
      await screen.findByText('Settings default (claude-opus-4-7)'),
    ).toBeInTheDocument();
  });
});
