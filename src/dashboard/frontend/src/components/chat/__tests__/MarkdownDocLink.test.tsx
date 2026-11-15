import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExplorerListDirResult } from '@overdeck/contracts';

const rpc = vi.hoisted(() => ({ listDir: vi.fn() }));
vi.mock('../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer/explorer-rpc')>()),
  listDir: rpc.listDir,
}));

import { MarkdownDocLink } from '../MarkdownDocLink';
import { clearDocLinkTargetCache } from '../docLinkTargets';
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext';
import { useActiveDock } from '../../dock/activeDock';
import { useWorkDockStore } from '../../dock/workDockStore';
import type { DocHref } from '../../../lib/markdownDocLinks';

type RelativeHref = Extract<DocHref, { kind: 'relative' }>;

function relTarget(path: string, over: Partial<RelativeHref> = {}): RelativeHref {
  return { kind: 'relative', path, trailingSlash: false, ...over };
}

function listing(entries: ExplorerListDirResult['entries'], truncated = false): ExplorerListDirResult {
  return { entries, truncated, absPath: '/abs' };
}

function entry(path: string, kind: 'file' | 'dir' = 'file') {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { name, path, kind, mtimeMs: 0, ignored: false };
}

function deckValue(over: Partial<StageDeckContextValue> = {}): StageDeckContextValue {
  return {
    deckKey: 'dfai',
    openOrFocusEditorPane: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    openBeside: vi.fn(),
    openDock: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  rpc.listDir.mockReset();
  clearDocLinkTargetCache();
  useActiveDock.setState({ current: null });
});

afterEach(() => {
  useActiveDock.setState({ current: null });
});

describe('MarkdownDocLink', () => {
  it('opens a sibling file with openBeside and preview true', async () => {
    rpc.listDir.mockResolvedValue(listing([entry('docs/fort3d.md')]));
    const deck = deckValue();

    render(
      <StageDeckProvider value={deck}>
        <MarkdownDocLink rootId="project:dfai" fromDir="docs" target={relTarget('fort3d.md')}>
          Fort
        </MarkdownDocLink>
      </StageDeckProvider>,
    );

    const link = await screen.findByRole('link', { name: 'Fort' });
    expect(link).not.toHaveAttribute('href');

    fireEvent.click(link);
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'project:dfai', path: 'docs/fort3d.md', preview: true });
    expect(deck.openBeside).toHaveBeenCalledTimes(1);
    expect(rpc.listDir).toHaveBeenCalledWith('project:dfai', 'docs');
  });

  it('passes the line from a :12 suffix, including via Enter', async () => {
    rpc.listDir.mockResolvedValue(listing([entry('docs/fort3d.md')]));
    const deck = deckValue();

    render(
      <StageDeckProvider value={deck}>
        <MarkdownDocLink rootId="project:dfai" fromDir="docs" target={relTarget('fort3d.md', { line: 12 })}>
          Fort
        </MarkdownDocLink>
      </StageDeckProvider>,
    );

    const link = await screen.findByRole('link', { name: 'Fort' });
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(deck.openBeside).toHaveBeenCalledWith({
      rootId: 'project:dfai',
      path: 'docs/fort3d.md',
      line: 12,
      preview: true,
    });
  });

  it('reveals a folder link in the Files dock, retargeting a dock on a different root first', async () => {
    rpc.listDir.mockResolvedValue(listing([entry('docs/levels', 'dir')]));
    const deck = deckValue();
    useActiveDock.setState({
      current: {
        deckKey: 'dfai',
        activePaneId: 'pane1',
        rootId: 'project:other',
        changedPaths: new Set(),
        openFile: vi.fn(),
        revealFile: vi.fn(),
      },
    });
    const setRootOverride = vi.spyOn(useWorkDockStore.getState(), 'setRootOverride');

    render(
      <StageDeckProvider value={deck}>
        <MarkdownDocLink rootId="project:dfai" fromDir="docs" target={relTarget('levels/', { trailingSlash: true })}>
          Levels
        </MarkdownDocLink>
      </StageDeckProvider>,
    );

    const link = await screen.findByRole('link', { name: 'Levels' });
    expect(link).toHaveAttribute('data-doc-link-state', 'dir');

    fireEvent.click(link);
    expect(setRootOverride).toHaveBeenCalledWith('dfai', 'project:dfai', 'pane1');
    expect(deck.openDock).toHaveBeenCalledWith({ tab: 'files', reveal: { rootId: 'project:dfai', path: 'docs/levels' } });
    expect(deck.openBeside).not.toHaveBeenCalled();
  });

  it('renders a missing target as not found and calls nothing on click', async () => {
    rpc.listDir.mockResolvedValue(listing([]));
    const deck = deckValue();

    render(
      <StageDeckProvider value={deck}>
        <MarkdownDocLink rootId="project:dfai" fromDir="docs" target={relTarget('missing.md')}>
          Missing
        </MarkdownDocLink>
      </StageDeckProvider>,
    );

    await waitFor(() => expect(screen.getByText('Missing')).toHaveAttribute('data-doc-link-state', 'missing'));
    const span = screen.getByText('Missing');
    expect(span).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(span);
    expect(deck.openBeside).not.toHaveBeenCalled();
    expect(deck.openDock).not.toHaveBeenCalled();
  });

  it('renders an outside-root target as not found', async () => {
    const deck = deckValue();

    render(
      <StageDeckProvider value={deck}>
        <MarkdownDocLink rootId="project:dfai" fromDir="docs" target={relTarget('../../x.md')}>
          Gone
        </MarkdownDocLink>
      </StageDeckProvider>,
    );

    const span = await screen.findByText('Gone');
    expect(span).toHaveAttribute('data-doc-link-state', 'outside');
    expect(rpc.listDir).not.toHaveBeenCalled();

    fireEvent.click(span);
    expect(deck.openBeside).not.toHaveBeenCalled();
    expect(deck.openDock).not.toHaveBeenCalled();
  });

  it('sends one listDir per folder for many links', async () => {
    rpc.listDir.mockResolvedValue(listing(Array.from({ length: 10 }, (_, i) => entry(`docs/f${i}.md`))));
    const deck = deckValue();

    render(
      <StageDeckProvider value={deck}>
        {Array.from({ length: 10 }, (_, i) => (
          <MarkdownDocLink key={i} rootId="project:dfai" fromDir="docs" target={relTarget(`f${i}.md`)}>
            {`f${i}`}
          </MarkdownDocLink>
        ))}
      </StageDeckProvider>,
    );

    await screen.findByRole('link', { name: 'f9' });
    expect(rpc.listDir).toHaveBeenCalledTimes(1);
  });
});
