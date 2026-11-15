import { describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, fireEvent } from '@testing-library/react';
import {
  deckNavigationActions,
  TestDeckNavigationProvider,
  useDeckNavigation,
  type DeckNavigationCall,
} from '../deckNavigation';

describe('deckNavigationActions (PAN-5293 §6.2)', () => {
  const offDeck = { activeTab: 'flywheel' as const, selectedProjectKey: 'alpha' };
  const onDeck = { activeTab: 'command-deck' as const, selectedProjectKey: 'alpha' };

  it('off the deck, a conversation shows the deck and then writes the conversation route', () => {
    expect(deckNavigationActions(offDeck, { projectKey: 'alpha', conversationRouteKey: '42' })).toEqual([
      { kind: 'show-deck' },
      { kind: 'conversation-route', routeKey: '42' },
    ]);
  });

  it('off the deck, an issue shows the deck and then writes the cockpit route', () => {
    expect(deckNavigationActions(offDeck, { projectKey: 'alpha', issueId: 'PAN-1' })).toEqual([
      { kind: 'show-deck' },
      { kind: 'cockpit-route', projectKey: 'alpha', issueId: 'PAN-1' },
    ]);
  });

  it('off the deck, a project target shows the deck and then writes the project route', () => {
    expect(deckNavigationActions(offDeck, { projectKey: 'alpha' })).toEqual([
      { kind: 'show-deck' },
      { kind: 'project-route', projectKey: 'alpha' },
    ]);
  });

  it('on the deck with the same project, a conversation writes only its route', () => {
    expect(deckNavigationActions(onDeck, { projectKey: 'alpha', conversationRouteKey: '42' })).toEqual([
      { kind: 'conversation-route', routeKey: '42' },
    ]);
  });

  it('on the deck with the same project, an issue or a project does nothing', () => {
    expect(deckNavigationActions(onDeck, { projectKey: 'alpha', issueId: 'PAN-1' })).toEqual([]);
    expect(deckNavigationActions(onDeck, { projectKey: 'alpha' })).toEqual([]);
  });

  it('a different project is selected first', () => {
    expect(deckNavigationActions(offDeck, { projectKey: 'beta', issueId: 'PAN-2' })).toEqual([
      { kind: 'select-project', projectKey: 'beta' },
      { kind: 'show-deck' },
      { kind: 'cockpit-route', projectKey: 'beta', issueId: 'PAN-2' },
    ]);
    expect(deckNavigationActions(onDeck, { projectKey: 'beta', conversationRouteKey: '7' })[0]).toEqual({
      kind: 'select-project',
      projectKey: 'beta',
    });
    expect(deckNavigationActions({ activeTab: 'home', selectedProjectKey: null }, { projectKey: 'beta' })[0]).toEqual({
      kind: 'select-project',
      projectKey: 'beta',
    });
  });
});

describe('useDeckNavigation', () => {
  it('throws outside a provider, naming DeckNavigationProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useDeckNavigation())).toThrow(/DeckNavigationProvider/);
    consoleError.mockRestore();
  });

  it('TestDeckNavigationProvider records calls and forwards them', () => {
    const calls: DeckNavigationCall[] = [];
    const openInDeck = vi.fn();
    function Probe() {
      const nav = useDeckNavigation();
      return (
        <>
          <button onClick={() => nav.openInDeck({ projectKey: 'alpha', issueId: 'PAN-1' })}>issue</button>
          <button onClick={() => nav.selectProject('beta', { updateUrl: false })}>project</button>
        </>
      );
    }
    render(
      <TestDeckNavigationProvider calls={calls} navigation={{ openInDeck }}>
        <Probe />
      </TestDeckNavigationProvider>,
    );
    fireEvent.click(screen.getByText('issue'));
    fireEvent.click(screen.getByText('project'));
    expect(calls).toEqual([
      { method: 'openInDeck', target: { projectKey: 'alpha', issueId: 'PAN-1' } },
      { method: 'selectProject', projectName: 'beta', opts: { updateUrl: false } },
    ]);
    expect(openInDeck).toHaveBeenCalledWith({ projectKey: 'alpha', issueId: 'PAN-1' });
  });
});
