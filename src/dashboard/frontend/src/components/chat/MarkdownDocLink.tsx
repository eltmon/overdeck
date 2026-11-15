/**
 * A document-relative link inside a Markdown preview (PAN-5337, WI-3).
 *
 * Opens the way a single click in the Files tree does: a file opens through
 * `openBeside` (a reused preview pane, D3); a folder reveals in the Files
 * dock (D6). A target `resolveDocPath` or the existence cache can't place
 * renders as a dashed, inert "not found" span (D12) instead of a link that
 * would 404 the browser.
 */

import { type KeyboardEvent, type ReactNode } from 'react';
import { useActiveDock } from '../dock/activeDock';
import { useWorkDockStore } from '../dock/workDockStore';
import { useStageDeck, type StageDeckContextValue } from '../Stage/StageDeckContext';
import { openCodePane } from '../explorer/openCodePane';
import { resolveDocPath, type DocHref, type ResolvedDocPath } from '../../lib/markdownDocLinks';
import { useDocLinkTarget } from './docLinkTargets';
import { cn } from '../../lib/utils';
import styles from '../CommandDeck/styles/command-deck.module.css';

export interface MarkdownDocLinkProps {
  rootId: string;
  fromDir: string;
  target: Extract<DocHref, { kind: 'relative' }>;
  children: ReactNode;
}

function NotFoundSpan({
  state,
  target,
  children,
}: {
  state: 'missing' | 'outside';
  target: string;
  children: ReactNode;
}) {
  return (
    <span
      data-doc-link-state={state}
      className="text-muted-foreground underline decoration-dashed"
      aria-disabled="true"
      title={`Link target not found: ${target}`}
    >
      {children}
    </span>
  );
}

function openFile(deck: StageDeckContextValue, rootId: string, path: string, line: number | undefined): void {
  const input = { rootId, path, ...(line !== undefined ? { line } : {}), preview: true };
  if (deck.openBeside) deck.openBeside(input);
  else openCodePane(deck.deckKey, input);
}

function revealFolder(deck: StageDeckContextValue, rootId: string, path: string): void {
  const activeDock = useActiveDock.getState().current;
  if (activeDock?.deckKey === deck.deckKey && activeDock.rootId !== rootId) {
    useWorkDockStore.getState().setRootOverride(deck.deckKey, rootId, activeDock.activePaneId ?? undefined);
  }
  deck.openDock?.({ tab: 'files', reveal: { rootId, path } });
}

export function MarkdownDocLink({ rootId, fromDir, target, children }: MarkdownDocLinkProps) {
  const resolved: ResolvedDocPath = resolveDocPath(fromDir, target.path);
  const insidePath = resolved.kind === 'inside' ? resolved.path : '';
  const targetState = useDocLinkTarget(rootId, insidePath);
  const deck = useStageDeck();

  if (resolved.kind === 'outside') {
    return (
      <NotFoundSpan state="outside" target={target.path}>
        {children}
      </NotFoundSpan>
    );
  }

  if (targetState === 'loading') {
    return (
      <span className={styles.mdLink} data-doc-link-state="loading">
        {children}
      </span>
    );
  }

  if (targetState === 'missing') {
    return (
      <NotFoundSpan state="missing" target={resolved.path}>
        {children}
      </NotFoundSpan>
    );
  }

  const isDir = targetState === 'dir';
  // D6: a folder link with no openDock, like a no-deck file link, has
  // nowhere to reveal itself and stays plain text instead of a dead control.
  if (!deck || (isDir && !deck.openDock)) return <span>{children}</span>;

  const runAction = isDir
    ? () => revealFolder(deck, rootId, resolved.path)
    : () => openFile(deck, rootId, resolved.path, target.line);

  return (
    <a
      role="link"
      tabIndex={0}
      className={cn(styles.mdLink, 'cursor-pointer')}
      data-doc-link-state={isDir ? 'dir' : 'file'}
      title={resolved.path}
      onClick={(event) => {
        event.preventDefault();
        runAction();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLAnchorElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        runAction();
      }}
    >
      {children}
    </a>
  );
}
