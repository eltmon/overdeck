import { ExternalLink } from 'lucide-react'
import { usePrQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'

function fileStatTone(additions: number, deletions: number): { mark: string; cls: string } {
  if (deletions > 0 && additions === 0) return { mark: 'D', cls: 'text-destructive-foreground' }
  if (additions > 0 && deletions === 0) return { mark: 'A', cls: 'text-success-foreground' }
  return { mark: 'M', cls: 'text-warning-foreground' }
}

function prTone(state: string, isDraft: boolean): CockpitTone {
  if (isDraft) return 'muted'
  const s = state.toUpperCase()
  if (s === 'MERGED') return 'review'
  if (s === 'CLOSED') return 'destructive'
  return 'info'
}

/**
 * CodeCard — the single place for the issue's code change: PR identity +
 * diffstat + changed-file list + a link to the full diff. The diffstat figure
 * itself lives in the band's metric strip; this card adds the per-file detail.
 * (Command Deck remodel S3.)
 */
export function CodeCard({ issueId }: { issueId: string }) {
  const prQuery = usePrQuery(issueId)
  const pr = prQuery.data?.pr ?? null

  if (!pr) {
    return (
      <CockpitCard tone="info" title="Code">
        <div className="text-[12px] text-muted-foreground">
          {prQuery.isLoading ? 'Loading…' : 'No pull request yet.'}
        </div>
      </CockpitCard>
    )
  }

  const files = pr.files ?? []
  const shown = files.slice(0, 5)
  const rest = files.length - shown.length

  return (
    <CockpitCard
      tone="info"
      title="Code"
      right={
        <CockpitPill tone={prTone(pr.state, pr.isDraft)}>
          #{pr.number} {pr.isDraft ? 'draft' : pr.state}
        </CockpitPill>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="font-mono text-[13px] tabular-nums">
          <span className="text-success-foreground">+{pr.additions}</span>{' '}
          <span className="text-destructive-foreground">−{pr.deletions}</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span>{pr.changedFiles} files</span>
        {pr.reviewDecision && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{pr.reviewDecision.replace(/_/g, ' ').toLowerCase()}</span>
          </>
        )}
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border px-2.5 py-1 text-[12px] transition-colors hover:bg-accent"
        >
          View diff <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {shown.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {shown.map((f) => {
            const { mark, cls } = fileStatTone(f.additions, f.deletions)
            return (
              <div key={f.path} className="flex items-center gap-2 font-mono text-[11.5px]">
                <span className={`w-3.5 shrink-0 text-center font-bold ${cls}`}>{mark}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/90" title={f.path}>{f.path}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {f.additions > 0 && <span className="text-success-foreground">+{f.additions}</span>}
                  {f.deletions > 0 && <span className="ml-1 text-destructive-foreground">−{f.deletions}</span>}
                </span>
              </div>
            )
          })}
          {rest > 0 && <div className="pl-[22px] text-[11px] text-muted-foreground">+ {rest} more files</div>}
        </div>
      )}
    </CockpitCard>
  )
}
