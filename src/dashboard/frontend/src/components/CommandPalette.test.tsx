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

    fireEvent.change(screen.getByPlaceholderText('Search actions, workspaces, agents…'), { target: { value: 'PAN-42' } });
    selectPaletteResult(screen.getAllByText('PAN-42')[0]);

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=overview');
  });

  it('opens the drawer from a branch search result for the owning issue', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search actions, workspaces, agents…'), { target: { value: 'feature/pan-42-command' } });
    selectPaletteResult(screen.getByText('Alpha command issue · feature/pan-42-command'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=overview');
  });

  it('opens the drawer from a title fragment search result', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search actions, workspaces, agents…'), { target: { value: 'Alpha command' } });
    selectPaletteResult(screen.getByText('Alpha command issue · feature/pan-42-command'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=overview');
  });
});

describe('CommandPalette flywheel action', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows /pan-flywheel action when searching for flywheel and navigates to the Flywheel page', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderPalette();

    await user.type(screen.getByPlaceholderText('Search actions, workspaces, agents…'), 'flywheel');

    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Run flywheel')).toBeInTheDocument();
    expect(screen.getByText('Start the autonomous pipeline run on all In Progress / In Review issues')).toBeInTheDocument();

    await user.click(screen.getByText('Run flywheel'));

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/flywheel');
    });
  });
});
