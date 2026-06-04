import { useMemo } from 'react'
import { useReviewStatusQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { CockpitPill, type CockpitTone } from './CockpitCard'

function statusTone(status: string): CockpitTone {
  if (['passed', 'merged', 'done', 'completed'].includes(status)) return 'success'
  if (['blocked', 'failed', 'dispatch_failed'].includes(status)) return 'destructive'
  if (['reviewing', 'testing', 'merging', 'verifying', 'running', 'queued'].includes(status)) return 'info'
  if (status === 'skipped') return 'muted'
  return 'muted'
}

const TYPE_TONE: Record<string, CockpitTone> = {
  review: 'review',
  test: 'warning',
  merge: 'success',
  inspect: 'info',
  uat: 'info',
}

function fmt(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * StatusHistoryTab — the restored chronological status-history tree (last seen
 * in the InspectorPanel era, then lost). Renders the review/test/merge/verify
 * transitions newest-first as a vertical timeline. Data already shipped by the
 * /api/review/:id/status endpoint (the `history` field). (Command Deck remodel S3.)
 */
export function StatusHistoryTab({ issueId }: { issueId: string }) {
  const rs = useReviewStatusQuery(issueId)
  const entries = useMemo(
    () => [...(rs.data?.history ?? [])].reverse(),
    [rs.data?.history],
  )

  if (entries.length === 0) {
    return (
      <div className="px-1 py-4 text-[12px] text-muted-foreground">
        {rs.isLoading ? 'Loading…' : 'No status history yet.'}
      </div>
    )
  }

  return (
    <div className="relative py-2 pl-4">
      <div className="absolute bottom-2 left-[6px] top-2 w-px bg-border" />
      <div className="flex flex-col gap-3">
        {entries.map((e, i) => (
          <div key={`${e.type}-${e.timestamp}-${i}`} className="relative">
            <span className={`absolute -left-4 top-1 h-[9px] w-[9px] rounded-full border-2 border-background ${
              statusTone(e.status) === 'success' ? 'bg-success'
                : statusTone(e.status) === 'destructive' ? 'bg-destructive'
                : statusTone(e.status) === 'info' ? 'bg-info' : 'bg-muted-foreground'
            }`} />
            <div className="flex flex-wrap items-center gap-2">
              <CockpitPill tone={TYPE_TONE[e.type] ?? 'muted'}>{e.type}</CockpitPill>
              <CockpitPill tone={statusTone(e.status)}>{e.status}</CockpitPill>
              <span className="font-mono text-[10px] text-muted-foreground">{fmt(e.timestamp)}</span>
            </div>
            {e.notes && <div className="mt-1 text-[12px] leading-snug text-foreground/85">{e.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
