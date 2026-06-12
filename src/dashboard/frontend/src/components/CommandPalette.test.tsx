import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../lib/store';
import type { Agent, Issue } from '../types';
import { CommandPalette } from './CommandPalette';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? 'PAN-0',
    identifier: overrides.identifier ?? 'PAN-0',
    title: overrides.title ?? 'Issue title',
    status: overrides.status ?? 'Todo',
    priority: overrides.priority ?? 3,
    labels: overrides.labels ?? [],
    url: `https://example.com/${overrides.identifier ?? 'PAN-0'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-pan-42',
    issueId: overrides.issueId ?? 'PAN-42',
    role: 'work',
    status: 'running',
    model: 'opus',
    runtime: 'claude-code',
    startedAt: '2026-05-18T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function renderCommandPalette() {
  return render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);
}

function renderPalette() {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />);
  return { onClose, onNavigate };
}

function selectPaletteResult(result: HTMLElement) {
  fireEvent.click(result);
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

// Cmdk renders each row with `data-value` = the item's stable id. Using it
// avoids the accessible-name flakiness introduced by the <Highlighted>
// component, which splits text across multiple spans.
function getOptionByValue(value: string): HTMLElement {
  const el = document.querySelector(`[role="option"][data-value="${value}"]`);
  if (!el) throw new Error(`No palette option with data-value="${value}"`);
  return el as HTMLElement;
}

describe('CommandPalette issue results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/');
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [issue({ identifier: 'PAN-42', title: 'Alpha command issue' })],
      agentsById: {
        'agent-pan-42': agent({
          id: 'agent-pan-42',
          issueId: 'PAN-42',
          git: { branch: 'feature/pan-42-command', uncommittedFiles: 0, latestCommit: 'init' },
        }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the drawer from an issue ID search result', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'PAN-42' } });
    selectPaletteResult(screen.getAllByText('PAN-42')[0]);

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=overview');
  });

  it('opens the drawer from a branch search result for the owning issue', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'feature/pan-42-command' } });
    selectPaletteResult(getOptionByValue('issue-PAN-42'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=overview');
  });

  it('opens the drawer from a title fragment search result', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'Alpha command' } });
    selectPaletteResult(getOptionByValue('issue-PAN-42'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=overview');
  });
});

describe('CommandPalette conversation results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDashboardStore.setState({ issuesRaw: [], agentsById: {} } as Parameters<typeof useDashboardStore.setState>[0]);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/palette/search')) {
        return {
          ok: true,
          json: async () => ({
            observations: [],
            conversations: [{
              sessionId: 'session-a',
              conversationId: 'session-a',
              projectId: 'panopticon-cli',
              role: 'assistant',
              ts: '2026-06-02T01:00:00.000Z',
              byteOffset: 42,
              displayContent: 'semantic transcript hit',
              excerpt: 'before ⦇needle⦈ after',
              excerptSegments: [
                { text: 'before ', match: false },
                { text: 'needle', match: true },
                { text: ' after', match: false },
              ],
              rank: 1,
            }],
            memory: [{
              kind: 'memory',
              id: 'mem-a',
              projectId: 'panopticon-cli',
              workspaceId: '',
              issueId: '',
              timestamp: '2026-06-02T01:00:00.000Z',
              displayContent: 'memory hit',
              excerpt: 'memory excerpt',
              excerptSegments: [{ kind: 'text', value: 'memory excerpt' }],
              tags: [],
              docType: 'memory',
              rank: 1,
            }],
            summaries: [],
          }),
        };
      }
      return { ok: true, json: async () => ({ commands: [] }) };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders conversations above memory with excerpt highlights', async () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'needle' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    // 'Conversations'/'Memory' also appear as filter pill buttons — scope the
    // assertions to the cmdk group headings.
    const groupHeading = (label: string) => {
      const heading = screen
        .getAllByText(label)
        .find((el) => el.hasAttribute('cmdk-group-heading'));
      expect(heading).toBeTruthy();
      return heading!;
    };

    const conversationsHeading = groupHeading('Conversations');
    expect(screen.getByText('semantic transcript hit')).toBeInTheDocument();
    expect(screen.getByText('needle')).toBeInTheDocument();

    const memoryHeading = groupHeading('Memory');
    expect(conversationsHeading.compareDocumentPosition(memoryHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens a selected conversation hit with its byte offset', async () => {
    const onOpenConversationHit = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onOpenConversationHit={onOpenConversationHit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'needle' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    fireEvent.click(getOptionByValue('conv-session-a-42'));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(onOpenConversationHit).toHaveBeenCalledWith({
      sessionId: 'session-a',
      conversationId: 'session-a',
      projectId: 'panopticon-cli',
      byteOffset: 42,
      label: 'semantic transcript hit',
    });
  });
});

describe('CommandPalette navigation actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows /pan-flywheel action when searching for flywheel and navigates to the Flywheel page', async () => {
    const user = userEvent.setup();
    c