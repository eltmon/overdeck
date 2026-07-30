/**
 * PAN-2908 · C-SIMPLE — simple-mode page tests.
 * Proves: sections render from real store state, one primary action per card,
 * pending input surfaces as an answerable question, simple issue page shows
 * the status card + conversation composer.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { AgentSnapshot, ReviewStatusSnapshot } from '@overdeck/contracts';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import { DialogProvider } from '../DialogProvider';
import { SimpleHomePage } from './SimpleHomePage';
import { SimpleIssuePage } from './SimpleIssuePage';
import { useDashboardStore } from '../../lib/store';
import { useUiMode } from '../../lib/simple/uiMode';
import type { Issue } from '../../types';

// The narrative feed (stream/poll chain) is too heavy for jsdom; the contract
// these tests prove is that the simple page MOUNTS it once an agent exists and
// hides it before then. The feed itself is covered in SimpleActivityFeed.test.
vi.mock('./SimpleActivityFeed', () => ({
  SimpleActivityFeed: (props: { agent: { id: string } | null }) => (
    <div data-testid="simple-activity-feed" data-agent-id={props.agent?.id ?? ''} />
  ),
}));

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.identifier ?? 'PAN-1',
    identifier: 'PAN-1',
    title: 'Set up PostHog product analytics',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: 'https://github.com/eltmon/overdeck/issues/1',
    state: 'in_progress',
    ...overrides,
  } as Issue;
}

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work', ...overrides };
}

function seed({ issues = [], agents = {}, review = {} }: {
  issues?: Issue[];
  agents?: Record<string, AgentSnapshot>;
  review?: Record<string, ReviewStatusSnapshot>;
}) {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    issuesRaw: issues,
    agentsById: agents,
    reviewStatusByIssueId: review,
  } as never);
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

describe('SimpleHomePage (C-SIMPLE)', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: 'simple', simpleIssueId: null });
    // ModelPicker (TalkItThrough composer) fetches model catalogs on mount.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/settings/available-models') return Response.json({});
      if (url === '/api/settings/openrouter/models') return Response.json({ models: [], favorites: [] });
      if (url === '/api/settings') return Response.json({ models: {} });
      if (url.includes('/api/settings/harness-policy')) return Response.json({ decisions: {} });
      if (url === '/api/issues/resource-allocated') return Response.json([]);
      if (url === '/api/registered-projects') return Response.json([{ key: 'panopticon-cli', name: 'panopticon-cli', path: '/tmp' }]);
      return Response.json({});
    }));
  });
  it('renders the working section with progress for an in-progress issue', () => {
    seed({
      issues: [makeIssue({ taskCounts: { completed: 4, total: 13 } })],
      agents: { 'agent-pan-1': makeAgent() },
    });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Working now')).toBeInTheDocument();
    expect(screen.getByText('Set up PostHog product analytics')).toBeInTheDocument();
    expect(screen.getByText(/task 4 of 13/)).toBeInTheDocument();
  });

  it('surfaces a pending question in Needs you with an answer input', () => {
    seed({
      issues: [makeIssue()],
      agents: {
        'agent-pan-1': makeAgent({
          pendingInputCount: 1,
          pendingInputKinds: ['askUserQuestion'],
          pendingAskUserQuestion: {
            toolUseId: 'tu-1',
            askedAt: new Date().toISOString(),
            questions: [{ question: 'Which PostHog project should events go to?', options: [] }],
          },
        }),
      },
    });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText(/Which PostHog project/)).toBeInTheDocument();
  });

  it('shows ready-to-merge with exactly one primary Merge action', () => {
    seed({
      issues: [makeIssue({ state: 'in_review' })],
      review: { 'PAN-1': { issueId: 'PAN-1', readyForMerge: true, reviewStatus: 'passed', mergeStatus: 'pending' } as ReviewStatusSnapshot },
    });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Ready to merge')).toBeInTheDocument();
    const merges = screen.getAllByRole('button', { name: 'Merge to main' });
    expect(merges).toHaveLength(1);
  });

  it('backlog issues do not clutter the home (not-started stays out)', () => {
    seed({ issues: [makeIssue({ state: 'backlog', title: 'Far-future idea' })] });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.queryByText('Far-future idea')).not.toBeInTheDocument();
  });
});

describe('SimpleIssuePage (C-SIMPLE)', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: 'simple', simpleIssueId: 'PAN-1' });
  });

  it('renders the status card, steps, and the steering composer', () => {
    seed({
      issues: [makeIssue()],
      agents: { 'agent-pan-1': makeAgent() },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.getByText('The agent is writing the code.')).toBeInTheDocument();
    expect(screen.getByTestId('simple-activity-feed')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Say something to the agent/)).toBeInTheDocument();
  });

  it('renders the narrative feed once an agent exists, with one composer', () => {
    seed({
      issues: [makeIssue()],
      agents: { 'agent-pan-1': makeAgent() },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    const feed = screen.getByTestId('simple-activity-feed');
    expect(feed).toHaveAttribute('data-agent-id', 'agent-pan-1');
    // …and there is still exactly ONE way to talk to it (the simple composer).
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('shows the empty state instead of the feed before work starts', () => {
    seed({ issues: [makeIssue()] });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.queryByTestId('simple-activity-feed')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing to show yet/)).toBeInTheDocument();
  });

  it('rich question: quotes the pending question with options and answers inline', async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    seed({
      issues: [makeIssue()],
      agents: {
        'agent-pan-1': makeAgent({
          pendingInputCount: 1,
          pendingAskUserQuestion: {
            toolUseId: 'tu-1',
            askedAt: new Date().toISOString(),
            questions: [{
              question: 'Keep a compatibility view for one release?',
              options: [
                { label: 'Keep the view', description: 'Old apps keep working.' },
                { label: 'Require the update' },
              ],
            }],
          },
        }),
      },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    // The question itself is the hero — not a generic "needs one decision".
    expect(screen.getByText(/Keep a compatibility view/)).toBeInTheDocument();
    expect(screen.getByText('Old apps keep working.')).toBeInTheDocument();
    // The below-feed composer is replaced by the in-card answer path.
    expect(screen.queryByPlaceholderText(/Type your answer/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Keep the view'));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/agent-pan-1/answer-question',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ answers: ['Keep the view'] }) }),
      );
    });
    await screen.findByText('Answer sent');
  });

  it('multi-question payloads fall back to the generic card + composer', () => {
    seed({
      issues: [makeIssue()],
      agents: {
        'agent-pan-1': makeAgent({
          pendingInputCount: 2,
          pendingAskUserQuestion: {
            toolUseId: 'tu-1',
            askedAt: new Date().toISOString(),
            questions: [
              { question: 'First?', options: [] },
              { question: 'Second?', options: [] },
            ],
          },
        }),
      },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.getByText('The agent needs one decision from you before it can continue.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type your answer/)).toBeInTheDocument();
  });

  it('a question with no written-out choices shows the terminal tail so the decision is visible', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/output')) {
        return Response.json({ output: 'Do you want to proceed with the migration?\n❯ 1. Yes\n  2. No\n\n' });
      }
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    seed({
      issues: [makeIssue()],
      agents: {
        // A pane-detected question: pending input with no structured payload.
        'agent-pan-1': makeAgent({ pendingInputCount: 1, pendingInputKinds: ['paneQuestion'] }),
      },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    // The generic card (nothing structured to quote)…
    expect(screen.getByText('The agent needs one decision from you before it can continue.')).toBeInTheDocument();
    // …plus the actual decision, straight from the agent's screen.
    expect(await screen.findByText(/Do you want to proceed with the migration/)).toBeInTheDocument();
    expect(screen.getByText(/showing on its screen/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-pan-1/output?lines=40');
  });

  it('the rich question card never fetches the terminal tail', () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    seed({
      issues: [makeIssue()],
      agents: {
        'agent-pan-1': makeAgent({
          pendingInputCount: 1,
          pendingAskUserQuestion: {
            toolUseId: 'tu-1',
            askedAt: new Date().toISOString(),
            questions: [{ question: 'Which color should the button be?', options: [] }],
          },
        }),
      },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.getByText(/Which color should the button be/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/output'));
  });

  it('a working agent with no question fetches no terminal tail', () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    seed({ issues: [makeIssue()], agents: { 'agent-pan-1': makeAgent() } });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/output'));
  });

  it('Get help routes to a new tracker issue pointing back at this task', () => {
    seed({
      issues: [makeIssue({ url: 'https://github.com/eltmon/overdeck/issues/42' })],
      agents: { 'agent-pan-1': makeAgent() },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    const link = screen.getByRole('link', { name: 'Get help' });
    expect(link).toHaveAttribute(
      'href',
      `https://github.com/eltmon/overdeck/issues/new?title=${encodeURIComponent('[HELP] PAN-1: Set up PostHog product analytics')}`,
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('ready state offers Merge to main as the one primary action', () => {
    seed({
      issues: [makeIssue({ state: 'in_review' })],
      review: { 'PAN-1': { issueId: 'PAN-1', readyForMerge: true, reviewStatus: 'passed', mergeStatus: 'pending' } as ReviewStatusSnapshot },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.getByRole('button', { name: 'Merge to main' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stop|Wipe|Reset/i })).not.toBeInTheDocument();
  });

  /**
   * PAN-3073: the stuck signal can come from the persistent review-status flag
   * with a perfectly healthy agent. "Get it unstuck" must call the unstick
   * door in that case — agent recover succeeds as a no-op and clears nothing.
   */
  it('review-stuck: Get it unstuck calls the workspace unstick door, not agent recover', async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    seed({
      issues: [makeIssue()],
      agents: { 'agent-pan-1': makeAgent() },
      review: { 'PAN-1': { issueId: 'PAN-1', reviewStatus: 'pending', stuck: true, stuckReason: 'feedback_delivery_needs_you' } as ReviewStatusSnapshot },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Get it unstuck' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/PAN-1/unstick', expect.objectContaining({ method: 'POST' }));
    });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/agents/agent-pan-1/recover', expect.anything());
  });

  it('agent-stuck: Get it unstuck still recovers the agent', async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    seed({
      issues: [makeIssue()],
      agents: { 'agent-pan-1': makeAgent({ troubled: true }) },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Get it unstuck' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-pan-1/recover', expect.objectContaining({ method: 'POST' }));
    });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/workspaces/PAN-1/unstick', expect.anything());
  });

  /**
   * §3.9 one-button gate: across EVERY user-facing display variant the status
   * card never renders more than one primary action (inline snapshot pins the
   * mapping; a second primary is the bug this exists to catch).
   */
  it('one-button rule: at most one primary action across all 7 display variants', () => {
    const CASES: Record<string, { agents?: Record<string, AgentSnapshot>; review?: ReviewStatusSnapshot; issue?: Partial<Issue> }> = {
      'not-started': { issue: { state: 'todo' } },
      'working': { agents: { 'agent-pan-1': makeAgent() } },
      'needs-you / question': {
        agents: {
          'agent-pan-1': makeAgent({
            pendingInputCount: 1,
            pendingAskUserQuestion: {
              toolUseId: 'tu-1',
              askedAt: new Date().toISOString(),
              questions: [{ question: 'Which project?', options: [] }],
            },
          }),
        },
      },
      'needs-you / stuck': { agents: { 'agent-pan-1': makeAgent({ troubled: true }) } },
      'needs-you / problems': {
        agents: { 'agent-pan-1': makeAgent() },
        review: { issueId: 'PAN-1', reviewStatus: 'blocked', updatedAt: new Date().toISOString() } as ReviewStatusSnapshot,
      },
      'ready': {
        review: { issueId: 'PAN-1', readyForMerge: true, reviewStatus: 'passed', mergeStatus: 'pending' } as ReviewStatusSnapshot,
      },
      'done': {
        review: { issueId: 'PAN-1', readyForMerge: false, reviewStatus: 'passed', mergeStatus: 'merged', prUrl: 'https://example.com/pr/1' } as ReviewStatusSnapshot,
      },
    };
    const labels: Record<string, string | null> = {};
    for (const [name, fixture] of Object.entries(CASES)) {
      cleanup();
      const needsReviewState = name === 'ready' || name === 'done' || name === 'needs-you / problems';
      seed({
        issues: [makeIssue(fixture.issue ?? (needsReviewState ? { state: 'in_review' } : {}))],
        agents: fixture.agents ?? {},
        review: fixture.review ? { 'PAN-1': fixture.review } : {},
      });
      const { container } = renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
      const primaries = container.querySelectorAll('[data-slot="primary-action"]');
      expect(primaries.length, `${name} rendered ${primaries.length} primary actions`).toBeLessThanOrEqual(1);
      labels[name] = primaries[0]?.textContent ?? null;
      // Destructive controls are unreachable in every state.
      expect(screen.queryByRole('button', { name: /Stop|Wipe|Reset|Destroy/i })).not.toBeInTheDocument();
    }
    expect(labels).toMatchInlineSnapshot(`
      {
        "done": "See what changed",
        "needs-you / problems": "Tell the agent to fix them",
        "needs-you / question": "Send answer",
        "needs-you / stuck": "Get it unstuck",
        "not-started": "Start work",
        "ready": "Merge to main",
        "working": null,
      }
    `);
  });
});
