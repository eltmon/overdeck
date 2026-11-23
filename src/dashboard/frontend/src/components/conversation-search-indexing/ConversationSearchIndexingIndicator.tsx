/**
 * PAN-5609 WI-6 — the top bar's conversation-search indexing chip: a hover
 * tooltip with a short summary and a click popover with full detail, deep
 * linking to the Conversation Search settings card.
 */
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ConversationSearchActivitySnapshot } from '@overdeck/contracts';
import { useNow } from '../../hooks/useNow';
import { requestSettingsSection } from '../../lib/settingsSection';
import { chipText, formatIndexingElapsed, kindLabel, useIndexingIndicatorView } from './indicatorVisibility';

const TOOLTIP_ID = 'conversation-search-indexing-tooltip';

function elapsedMs(snapshot: ConversationSearchActivitySnapshot, nowMs: number): number {
  if (snapshot.startedAt === null) return 0;
  const endMs = snapshot.endedAt !== null ? new Date(snapshot.endedAt).getTime() : nowMs;
  return Math.max(0, endMs - new Date(snapshot.startedAt).getTime());
}

/** "Running for 42s" / "Finished after 3m 05s" — ticks only while mounted. */
function TooltipElapsedLine({ snapshot }: { snapshot: ConversationSearchActivitySnapshot }) {
  const now = useNow(1_000);
  if (snapshot.startedAt === null) return null;
  const elapsed = formatIndexingElapsed(elapsedMs(snapshot, now.getTime()));
  return <div>{snapshot.active ? `Running for ${elapsed}` : `Finished after ${elapsed}`}</div>;
}

/** The popover's bare "Elapsed" value — ticks only while mounted. */
function PopoverElapsedValue({ snapshot }: { snapshot: ConversationSearchActivitySnapshot }) {
  const now = useNow(1_000);
  if (snapshot.startedAt === null) return <>—</>;
  return <>{formatIndexingElapsed(elapsedMs(snapshot, now.getTime()))}</>;
}

export function ConversationSearchIndexingIndicator({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const view = useIndexingIndicatorView();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if ((!view.visible && !open) || view.snapshot === null) return null;
  const snapshot = view.snapshot;
  const showTooltip = hover && !open;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="conversation-search-indexing-indicator"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={chipText(snapshot)}
        aria-describedby={showTooltip ? TOOLTIP_ID : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <RefreshCw className="h-3 w-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        {chipText(snapshot)}
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          id={TOOLTIP_ID}
          className="absolute right-0 top-full z-50 mt-1.5 w-max max-w-[260px] rounded-md border border-border bg-card px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground shadow-lg"
        >
          <div>{kindLabel(snapshot.kind)}</div>
          <div>
            {snapshot.filesIndexed}/{snapshot.filesScanned} files · {snapshot.chunksIndexed} chunks
          </div>
          <TooltipElapsedLine snapshot={snapshot} />
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Conversation search indexing"
          data-testid="conversation-search-indexing-popover"
          className="absolute right-0 top-full z-50 mt-1.5 w-[320px] rounded-md border border-border bg-card p-3 text-xs text-foreground shadow-lg"
        >
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Conversation search indexing
          </div>
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Kind</dt>
              <dd>{kindLabel(snapshot.kind)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Files</dt>
              <dd>{snapshot.filesIndexed}/{snapshot.filesScanned}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Chunks</dt>
              <dd>{snapshot.chunksIndexed}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">Current file</dt>
              <dd className="truncate" title={snapshot.currentFile ?? undefined}>
                {snapshot.currentFile ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Queued</dt>
              <dd>{snapshot.queued}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">In flight</dt>
              <dd>{snapshot.inFlight}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Started</dt>
              <dd>{snapshot.startedAt !== null ? new Date(snapshot.startedAt).toLocaleTimeString() : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Elapsed</dt>
              <dd><PopoverElapsedValue snapshot={snapshot} /></dd>
            </div>
            {snapshot.lastError !== null && (
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">Last error</dt>
                <dd className="truncate text-destructive" title={snapshot.lastError}>
                  {snapshot.lastError}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="text-[11px] font-medium text-primary hover:underline"
              onClick={() => {
                setOpen(false);
                requestSettingsSection('conversation-search');
                onOpenSettings?.();
              }}
            >
              Open conversation search settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
