// The per-turn "what changed" card (PAN-5295 FR-1, D2-8), under a user turn's
// last assistant message. It replaces the old "Changed files" card.
//
// Inside a Stage its actions open the dock: Review opens the Changes diff view
// on the turn's first file and steps through exactly this turn's files (D2-6);
// Show in files filters the Files tab to this conversation (D2-7). Outside a
// Stage, Review and a row open the diff window instead (D2-3).

import { useMemo, useState } from 'react';
import { FileDiff } from 'lucide-react';
import { diffTargetOf } from '../../dock/changes-model';
import { ChangeFileRow } from '../../dock/changes/ChangeFileRow';
import { useConversationChangesContext } from '../conversationChanges/ConversationChangesScope';
import type { TurnChanges } from './turnChanges';

const VISIBLE_ROWS = 8;
const TAG = 'shrink-0 rounded-md border px-1.5 font-mono text-[11px] leading-[18px]';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function TurnChangesCard({ turn }: { turn: TurnChanges }) {
  const ctx = useConversationChangesContext();
  const [showAll, setShowAll] = useState(false);
  const changes = ctx?.changes ?? null;
  const stage = ctx?.stage ?? null;

  const targets = useMemo(
    () => (changes && stage ? turn.rows.map((row) => diffTargetOf(changes, row.file, row.commit, stage.rootPathOf)) : []),
    [changes, stage, turn.rows],
  );

  if (!ctx || !changes) return null;

  const rows = showAll ? turn.rows : turn.rows.slice(0, VISIBLE_ROWS);
  const review = (): void => {
    if (stage && targets.length > 0) stage.openDiff(targets[0]!, targets);
    else ctx.openDiffWindow();
  };

  return (
    <div data-testid="turn-changes-card" className="my-2 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 py-2 pl-3 pr-2 text-[12.5px]">
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{plural(turn.files, 'file changed', 'files changed')}</span>
        <span className="font-mono text-[11px]">
          <span className="text-success-foreground">+{turn.additions}</span>{' '}
          <span className="text-destructive-foreground">−{turn.deletions}</span>
        </span>
        {turn.commitsPushed > 0 && (
          <span className={`${TAG} border-border text-muted-foreground`}>{plural(turn.commitsPushed, 'commit pushed', 'commits pushed')}</span>
        )}
        {turn.commitsLocal > 0 && (
          <span className={`${TAG} border-border text-muted-foreground`}>{plural(turn.commitsLocal, 'commit not pushed', 'commits not pushed')}</span>
        )}
        {turn.uncommittedFiles > 0 && (
          <span className={`${TAG} badge-bg-state-needs-you badge-border-state-needs-you text-state-needs-you`}>
            {turn.uncommittedFiles} not committed
          </span>
        )}
        <span className="ml-auto flex shrink-0 gap-1">
          {stage && (
            <button
              type="button"
              onClick={stage.showInFiles}
              className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Show in files
            </button>
          )}
          <button
            type="button"
            onClick={review}
            className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent"
          >
            Review
          </button>
        </span>
      </div>
      <div className="border-t border-border py-1">
        {rows.map((row, index) => {
          const rootPath = stage ? stage.rootPathOf(row.file.path) : null;
          return (
            <ChangeFileRow
              key={`${row.commit?.sha ?? 'work'}:${row.file.path}`}
              inset={false}
              path={rootPath ?? row.file.path}
              additions={row.file.additions}
              deletions={row.file.deletions}
              rootPath={rootPath}
              onDiff={() => (stage ? stage.openDiff(targets[index]!, targets) : ctx.openDiffWindow(row.file.path))}
              onOpenBeside={() => {
                if (stage && rootPath) stage.openBeside(rootPath);
              }}
              onReveal={() => {
                if (stage && rootPath) stage.reveal(rootPath);
              }}
            />
          );
        })}
        {!showAll && turn.rows.length > VISIBLE_ROWS && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="ml-3 mt-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Show all {turn.rows.length} files
          </button>
        )}
      </div>
    </div>
  );
}
