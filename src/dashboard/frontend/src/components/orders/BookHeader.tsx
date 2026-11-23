/**
 * The selected book's header (PAN-5597 WI-5): its name (click to rename), a
 * phase tag, one plain sentence about what the phase means, and only the
 * actions that apply to that phase. Phase comes from the server; this
 * component never re-derives it.
 */
import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { MenuItemButton, MenuOverlay, MenuSurface } from '../shared/ContextMenu';
import { bookPath, errorMessage, orderBookRequest, type OrderBookEditorProps } from './orderBookApi';
import type { OrderBookView } from './types';

const PAUSE_DEFAULT_REASON = 'Operator paused new pickup.';

interface BookHeaderProps extends OrderBookEditorProps {
  /** Name of the active book, for a queued book's "waits behind" sentence. */
  activeBookName?: string | null;
  flywheelRunning: boolean;
  onAddIssues?: () => void;
  /** Called after `POST /api/orders/:id/start` succeeds. */
  onStarted?: (runId: string) => void;
}

type Tone = 'neutral' | 'info' | 'warning' | 'success';

const TAG_CLASSES: Record<Tone, string> = {
  neutral: 'border-border text-muted-foreground',
  info: 'border-info/[0.32] bg-info/[0.08] text-info-foreground',
  warning: 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground',
  success: 'border-success/[0.32] bg-success/[0.08] text-success-foreground',
};

const BUTTON = 'rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = 'rounded-md border border-primary bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

function phaseTag(book: OrderBookView): { label: string; tone: Tone } {
  if (book.phase === 'draft') return { label: 'Draft', tone: 'neutral' };
  if (book.phase === 'archived') return { label: 'Archived', tone: 'neutral' };
  if (book.finished) return { label: 'Finished', tone: 'success' };
  if (book.phase === 'queued') return { label: `Queued · #${book.queuePosition ?? '?'}`, tone: 'neutral' };
  return book.settings.posture === 'drain'
    ? { label: 'Active · pickup paused', tone: 'warning' }
    : { label: 'Active', tone: 'info' };
}

function phaseSentence(book: OrderBookView, activeBookName: string | null | undefined, flywheelRunning: boolean): ReactNode {
  if (book.phase === 'draft') return 'Nothing starts from a draft. Queue it when the list is right.';
  if (book.phase === 'archived') return 'Kept for the record. Its issues are free to join another book.';
  if (book.finished) {
    return book.phase === 'queued' ? 'Every issue has landed. Archive it to clear it from the queue.' : null;
  }
  if (book.phase === 'queued') {
    return `Waits behind "${activeBookName ?? 'the active book'}". It becomes active when the books ahead of it are archived or moved back to draft.`;
  }
  if (!flywheelRunning) return 'This book is next, but the Flywheel is stopped.';
  return <>The Flywheel works from this book. Its issues are cleared to start, and <span className="font-mono">pan start</span> still works for anything else.</>;
}

export function BookHeader({ book, project, onBookChange, onError, activeBookName, flywheelRunning, onAddIssues, onStarted }: BookHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(book.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseReason, setPauseReason] = useState(PAUSE_DEFAULT_REASON);
  const [busy, setBusy] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      // Await first: `onBookChange?.(await …)` would skip the request when no callback is passed.
      const updated = await orderBookRequest(bookPath(book.id), project, { method: 'PATCH', body });
      onBookChange?.(updated);
      return true;
    } catch (cause) {
      onError?.(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startRename = () => {
    setDraftName(book.name);
    setRenaming(true);
    setMenuOpen(false);
  };
  const commitRename = async () => {
    if (!renaming) return;
    setRenaming(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === book.name) return;
    await patch({ name: trimmed });
  };

  const startFlywheel = async () => {
    setBusy(true);
    try {
      const result = await orderBookRequest<{ runId: string }>(bookPath(book.id, '/start'), project, { method: 'POST' });
      onStarted?.(result.runId);
    } catch (cause) {
      onError?.(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmPause = async () => {
    if (await patch({ settings: { posture: 'drain', postureReason: pauseReason.trim() || PAUSE_DEFAULT_REASON } })) setPausing(false);
  };

  const tag = phaseTag(book);
  const sentence = phaseSentence(book, activeBookName, flywheelRunning);
  const blocked = (book.validation?.blocks.length ?? 0) > 0;
  const paused = book.settings.posture === 'drain';
  const addIssues = <button type="button" className={BUTTON} onClick={onAddIssues}>+ Add issues</button>;
  const moveToDraft = <button type="button" className={BUTTON} disabled={busy} onClick={() => void patch({ status: 'draft' })}>Move back to draft</button>;

  let actions: ReactNode;
  if (book.phase === 'draft') {
    actions = <>
      <button type="button" className={PRIMARY} disabled={busy || blocked} title={blocked ? 'Fix the problems below first' : undefined} onClick={() => void patch({ status: 'ready' })}>Queue book</button>
      {addIssues}
    </>;
  } else if (book.phase === 'archived') {
    actions = <button type="button" className={BUTTON} disabled={busy} onClick={() => void patch({ status: 'draft' })}>Restore as draft</button>;
  } else if (book.finished) {
    actions = book.phase === 'queued'
      ? <button type="button" className={PRIMARY} disabled={busy} onClick={() => void patch({ status: 'complete' })}>Archive</button>
      : addIssues;
  } else if (book.phase === 'queued') {
    actions = <>{moveToDraft}{addIssues}</>;
  } else {
    actions = <>
      {!flywheelRunning && <button type="button" className={PRIMARY} disabled={busy} onClick={() => void startFlywheel()}>Start Flywheel</button>}
      {flywheelRunning && !paused && <button type="button" className={BUTTON} onClick={() => setPausing(true)}>Pause pickup</button>}
      {moveToDraft}
      {addIssues}
    </>;
  }

  return (
    <header className="grid gap-2" data-section="OrderBookHeader">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              aria-label="Book name"
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitRename();
                if (event.key === 'Escape') setRenaming(false);
              }}
              className="w-full max-w-lg rounded-md border border-input bg-background px-2 py-1 text-lg font-semibold text-foreground"
            />
          ) : (
            <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">
              <button type="button" onClick={startRename} title="Rename this book" className="max-w-full truncate text-left hover:underline">{book.name}</button>
            </h2>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          <span className="relative">
            <button
              ref={menuTrigger}
              type="button"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className={BUTTON}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <MenuOverlay onClick={() => setMenuOpen(false)} />
                <MenuSurface
                  aria-label="Book actions"
                  onClose={() => setMenuOpen(false)}
                  returnFocusRef={menuTrigger}
                  className="absolute right-0 top-full z-[1000] mt-1 w-[220px]"
                >
                  <MenuItemButton onClick={startRename}>Rename</MenuItemButton>
                  <MenuItemButton
                    onClick={() => {
                      setMenuOpen(false);
                      void navigator.clipboard?.writeText(book.id);
                    }}
                  >
                    Copy book ID for the CLI
                  </MenuItemButton>
                  {book.phase !== 'archived' && (
                    <MenuItemButton
                      onClick={() => {
                        setMenuOpen(false);
                        void patch({ status: 'complete' });
                      }}
                    >
                      Archive
                    </MenuItemButton>
                  )}
                </MenuSurface>
              </>
            )}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-body-foreground">
        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] ${TAG_CLASSES[tag.tone]}`}>{tag.label}</span>
        {sentence && <span>{sentence}</span>}
      </div>
      {pausing && (
        <div className="grid max-w-xl gap-2 rounded-lg border border-warning/[0.32] bg-warning/[0.08] p-3 text-xs" aria-label="Pause pickup">
          <p className="text-foreground">Work already running will finish. Nothing new starts from this book until you resume.</p>
          <label className="grid gap-1 text-muted-foreground">
            Reason
            <input
              value={pauseReason}
              onChange={(event) => setPauseReason(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void confirmPause()}>Pause pickup</button>
            <button type="button" className={BUTTON} onClick={() => setPausing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </header>
  );
}
