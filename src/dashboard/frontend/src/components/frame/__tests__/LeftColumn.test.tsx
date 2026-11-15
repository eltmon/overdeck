/**
 * PAN-5293 WI-16: the left column shell, and the deck dialogs it mounts.
 */
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEFT_COLUMN_COLLAPSED_KEY, LEFT_COLUMN_WIDTH_KEY, LeftColumn,
} from '../LeftColumn';
import { DeckDialogsHost } from '../deck/DeckDialogsHost';
import { TestDeckNavigationProvider } from '../deck/deckNavigation';
import { installShortcutListener, resetShortcutsForTests } from '../../../lib/shortcuts/registry';

vi.mock('../ConversationsSection', () => ({ ConversationsSection: () => <div data-testid="stub-conversations" /> }));
vi.mock('../IssuesSection', () => ({ IssuesSection: () => <div data-testid="stub-issues" /> }));
vi.mock('../WorkspacesSection', () => ({ WorkspacesSection: () => <div data-testid="stub-workspaces" /> }));
vi.mock('../LeftColumnFooter', () => ({ LeftColumnFooter: () => <div data-testid="stub-footer" /> }));
vi.mock('../LeftNav', () => ({ LeftNav: () => <nav data-testid="stub-nav" /> }));
vi.mock('../NewConversationButton', () => ({ NewConversationButton: () => <button data-testid="stub-new-conversation">New conversation</button> }));
vi.mock('../deck/DeckDataHost', () => ({ DeckDataHost: () => null }));
vi.mock('../../CommandDeck/ForkModal', () => ({
  ForkModal: ({ conversation }: { conversation: { name: string } }) => <div data-testid="fork-modal">{conversation.name}</div>,
}));
vi.mock('../deck/useOpenConversation', () => ({ useOpenConversation: () => vi.fn() }));

let narrow = false;
function stubMatchMedia() {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

function Shell({ selectedProject }: { selectedProject: string | null }) {
  useEffect(() => installShortcutListener(), []);
  return (
    <TestDeckNavigationProvider>
      <LeftColumn
        activeTab="flywheel"
        selectedProject={selectedProject}
        onTabChange={vi.fn()}
        onNewProject={vi.fn()}
        onNewWorkspace={vi.fn()}
        onOpenUpdater={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onOpenShortcuts={vi.fn()}
      />
    </TestDeckNavigationProvider>
  );
}

function renderShell(selectedProject: string | null = 'alpha') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['command-deck-projects'], []);
  client.setQueryData(['conversations'], []);
  client.setQueryData(['registered-projects'], []);
  return render(
    <QueryClientProvider client={client}>
      <Shell selectedProject={selectedProject} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  narrow = false;
  stubMatchMedia();
  resetShortcutsForTests();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LeftColumn (PAN-5293 F-D18)', () => {
  it('starts 264 px wide and its drag handle clamps to 400 and persists', () => {
    renderShell();
    const column = screen.getByTestId('left-column');
    expect(column.style.width).toBe('264px');

    fireEvent.mouseDown(screen.getByTestId('left-column-resize'), { clientX: 264 });
    fireEvent.mouseMove(window, { clientX: 500 });
    fireEvent.mouseUp(window);
    expect(column.style.width).toBe('400px');
    expect(localStorage.getItem(LEFT_COLUMN_WIDTH_KEY)).toBe('400');

    fireEvent.mouseDown(screen.getByTestId('left-column-resize'), { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);
    expect(column.style.width).toBe('240px');
  });

  it('[ collapses it to 48 px, hides the lists and persists', () => {
    renderShell();
    expect(screen.getByTestId('stub-conversations')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document.body, { key: '[' });
    });
    expect(screen.getByTestId('left-column').style.width).toBe('48px');
    expect(screen.queryByTestId('stub-conversations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-issues')).not.toBeInTheDocument();
    expect(localStorage.getItem(LEFT_COLUMN_COLLAPSED_KEY)).toBe('true');
  });

  it('with no project shows "Choose a project", the hint and no list sections', () => {
    renderShell(null);
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('Choose a project');
    expect(screen.getByText('Pick a project to see its conversations and issues')).toBeInTheDocument();
    expect(screen.getByTestId('stub-new-conversation')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-conversations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-issues')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-workspaces')).not.toBeInTheDocument();
  });

  it('below 900 px is a drawer hidden until Open navigation, closed by its overlay', () => {
    narrow = true;
    stubMatchMedia();
    renderShell();
    expect(screen.getByTestId('left-column')).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByTestId('left-column')).toBeVisible();

    fireEvent.click(screen.getByTestId('left-column-overlay'));
    expect(screen.getByTestId('left-column')).not.toBeVisible();
  });
});

describe('DeckDialogsHost (PAN-5293 §6.1)', () => {
  it('opens the fork modal for an overdeck:open-fork-modal event', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DeckDialogsHost selectedProject="alpha" />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('fork-modal')).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('overdeck:open-fork-modal', { detail: { conversation: { id: 1, name: 'conv-a' }, mode: 'handoff' } }));
    });
    expect(screen.getByTestId('fork-modal')).toHaveTextContent('conv-a');
  });
});
