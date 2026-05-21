import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from './Sidebar';
import { useDashboardStore } from '../lib/store';
import type { Tab } from './Header';
import type { Issue } from '../types';

vi.mock('./CloisterStatusBar', () => ({ CloisterStatusBar: () => <div data-testid="cloister-status" /> }));
vi.mock('./FreshnessIndicator', () => ({ FreshnessIndicator: () => <div data-testid="freshness-indicator" /> }));
vi.mock('./DeaconPauseToggle', () => ({
  DeaconPauseToggle: () => <button type="button">Pause Deacon</button>,
}));
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

function renderSidebar(options: { activeTab?: Tab; runs?: Array<{ id: string; status: string }> } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const onTabChange = vi.fn();
  const onSearchOpen = vi.fn();
  const runs = options.runs ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/version') {
      return Response.json({ version: '0.5.0', isDev: false });
    }
    if (url === '/api/flywheel/runs?limit=10') {
      return Response.json(runs);
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(
    <QueryClientProvider client={client}>
      <Sidebar activeTab={options.activeTab ?? 'pipeline'} onTabChange={onTabChange} onSearchOpen={onSearchOpen} />
    </QueryClientProvider>,
  );

  return { container, onTabChange, fetchMock };
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? 'PAN-0',
    identifier: overrides.identifier ?? 'PAN-0',
    title: overrides.title ?? 'Issue title',
    status: overrides.status ?? 'Todo',
    priority: overrides.priority ?? 4,
    labels: overrides.labels ?? [],
    url: `https://example.com/${overrides.identifier ?? 'PAN-0'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('Sidebar navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/version') {
        return new Response(JSON.stringify({ version: '0.9.3', isDev: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  it('orders Operations as Command Deck, Board, Pipeline, Awaiting Merge, Agents, AutoPreso, Flywheel', () => {
    const { container, onTabChange } = renderSidebar({ activeTab: 'command-deck' });

    const operationLabels = Array.from(container.querySelectorAll('nav [data-testid^="sidebar-"]'))
      .slice(0, 7)
      .map((button) => button.textContent?.trim());

    expect(operationLabels).toEqual([
      'Command Deck',
      'Board',
      'Pipeline',
      'Awaiting Merge',
      'Agents',
      'AutoPreso',
      'Flywheel',
    ]);
    expect(screen.getByTestId('sidebar-awaiting-merge')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sidebar-command-deck'));
    expect(onTabChange).toHaveBeenCalledWith('command-deck');
  });

  it('routes the expanded logo to Pipeline', () => {
    const { onTabChange } = renderSidebar({ activeTab: 'kanban' });

    const logo = screen.getByTitle('Go to Pipeline');
    fireEvent.click(logo);
    expect(onTabChange).toHaveBeenCalledWith('pipeline');
  });

  it('keeps collapsed-mode icons clickable', () => {
    localStorage.setItem('panopticon.ui.sidebarCollapsed', 'true');
    const { onTabChange } = renderSidebar({ activeTab: 'kanban' });

    const logo = screen.getByTitle('Go to Pipeline');
    fireEvent.click(logo);
    expect(onTabChange).toHaveBeenCalledWith('pipeline');

    const commandDeckButton = screen.getByTestId('sidebar-command-deck');
    expect(commandDeckButton).toHaveAttribute('title', 'Command Deck');
    expect(commandDeckButton).toHaveTextContent('');

    fireEvent.click(commandDeckButton);
    expect(onTabChange).toHaveBeenCalledWith('command-deck');
  });
});

describe('Sidebar pipeline filter groups', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/version') return Response.json({ version: '1.0.0', isDev: false });
      return Response.json({});
    }));
    useDashboardStore.setState({
      issuesRaw: [
        issue({ identifier: 'PAN-1', status: 'In Progress', state: 'in_progress', project: { id: 'pan', name: 'Panopticon', color: '#fff' } }),
        issue({ identifier: 'PAN-2', status: 'Todo', project: { id: 'ops', name: 'Operations', color: '#fff' } }),
        issue({ identifier: 'PAN-3', status: 'Done', stateType: 'completed' }),
      ],
      agentsById: {},
      reviewStatusByIssueId: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('renders Filter phase and Projects groups when activeTab is pipeline', () => {
    const { container } = renderSidebar({ activeTab: 'pipeline' });

    expect(container.querySelector('[data-testid="sidebar-pipeline-phases"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="sidebar-pipeline-projects"]')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-phase-all')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-phase-work')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-phase-todo')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-project-pan')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-project-ops')).toBeInTheDocument();
  });

  it('does not render pipeline filter groups when activeTab is kanban', () => {
    const { container } = renderSidebar({ activeTab: 'kanban' });
    expect(container.querySelector('[data-testid="sidebar-pipeline-phases"]')).toBeNull();
    expect(container.querySelector('[data-testid="sidebar-pipeline-projects"]')).toBeNull();
  });

  it('clicking a phase updates URL and dispatches popstate', () => {
    const popStateEvents: Event[] = [];
    window.addEventListener('popstate', (e) => popStateEvents.push(e));
    renderSidebar({ activeTab: 'pipeline' });

    fireEvent.click(screen.getByTestId('sidebar-phase-work'));

    expect(new URLSearchParams(window.location.search).get('phase')).toBe('work');
    expect(popStateEvents.length).toBeGreaterThan(0);
    window.removeEventListener('popstate', () => {});
  });

  it('clicking a project toggles it in the URL projects param', () => {
    renderSidebar({ activeTab: 'pipeline' });

    fireEvent.click(screen.getByTestId('sidebar-project-pan'));
    expect(new URLSearchParams(window.location.search).get('projects')).toBe('pan');

    fireEvent.click(screen.getByTestId('sidebar-project-pan'));
    expect(new URLSearchParams(window.location.search).get('projects')).toBeNull();
  });

  it('phase filter group shows correct counts per phase', () => {
    const { container } = renderSidebar({ activeTab: 'pipeline' });
    const phasesGroup = container.querySelector('[data-testid="sidebar-pipeline-phases"]') as HTMLElement;
    // PAN-3 is closed so not counted; PAN-1 is in_progress (work phase), PAN-2 is Todo
    const workButton = within(phasesGroup).getByTestId('sidebar-phase-work');
    expect(workButton).toHaveTextContent('1');
    const todoButton = within(phasesGroup).getByTestId('sidebar-phase-todo');
    expect(todoButton).toHaveTextContent('1');
  });

  it('active phase is reflected when URL has phase param on mount', () => {
    window.history.replaceState(null, '', '/?phase=work');
    renderSidebar({ activeTab: 'pipeline' });
    const workButton = screen.getByTestId('sidebar-phase-work');
    expect(workButton.className).toContain('border-primary');
  });

  it('project items render color mark and issue-prefix tag', () => {
    renderSidebar({ activeTab: 'pipeline' });

    const panButton = screen.getByTestId('sidebar-project-pan');
    const dot = panButton.querySelector('span[style]');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveStyle('background: #fff');
    expect(panButton).toHaveTextContent('PAN');
  });
});
