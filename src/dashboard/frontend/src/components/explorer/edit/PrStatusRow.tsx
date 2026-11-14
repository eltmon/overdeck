/**
 * The PR row of the edit-workspace banner (PAN-5191, FR-9). The state is a
 * plain word, never a pill. Merge is enabled only when GitHub's verdict
 * allows it and nothing is uncommitted; otherwise the reason shows inline
 * and as the button's title. There is no polling: the banner refreshes the
 * row after a push, after a merge attempt and on Refresh.
 */
import type { EditWorkspacePr } from '@overdeck/contracts'

export const UNCOMMITTED_REASON = 'Commit and push your changes first.'

const BUTTON =
  'h-6 rounded border border-border px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40'

export interface PrStatusRowProps {
  pr: EditWorkspacePr
  /** The edit root's git status shows uncommitted changes. */
  hasChanges: boolean
  onMerge(): void
  onRefresh(): void
  onPush(): void
  merging: boolean
}

export function prStateWord(pr: EditWorkspacePr): string {
  if (pr.state === 'MERGED') return 'Merged'
  if (pr.state === 'CLOSED') return 'Closed'
  return pr.isDraft ? 'Draft' : 'Open'
}

export function PrStatusRow({ pr, hasChanges, onMerge, onRefresh, onPush, merging }: PrStatusRowProps) {
  const open = pr.state === 'OPEN'
  const blocked = !pr.canMerge ? (pr.reason ?? 'GitHub does not allow this merge.') : hasChanges ? UNCOMMITTED_REASON : null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="edit-pr-row">
      <a href={pr.url} target="_blank" rel="noreferrer" className="font-mono text-foreground underline-offset-2 hover:underline">
        PR #{pr.number}
      </a>
      <span className="text-muted-foreground">{prStateWord(pr)}</span>
      {open && (
        <button type="button" className={BUTTON} disabled={blocked !== null || merging} title={blocked ?? undefined} onClick={onMerge}>
          {merging ? 'Merging…' : 'Merge'}
        </button>
      )}
      {open && hasChanges && (
        <button type="button" className={BUTTON} onClick={onPush}>
          Push changes
        </button>
      )}
      <button type="button" className={BUTTON} onClick={onRefresh}>
        Refresh
      </button>
      {open && blocked && (
        <span className="text-muted-foreground" data-testid="edit-pr-merge-reason">
          {blocked}
        </span>
      )}
    </div>
  )
}
