import { useMemo } from 'react'
import {
  usePrQuery,
  useIssueCostsQuery,
  useActivityQuery,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'

interface Metric {
  label: string
  value: React.ReactNode
  sub?: string
}

function tokensShort(n: number | undefined): string | null {
  if (!n || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function relativeFromNow(iso: string | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const mins = Math.floor((Date.now() - ms) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

/**
 * IssueMetricStrip — the band's single source of truth for the issue's headline
 * numbers: cost · diff · PR · sessions · last-activity. Replaces the old
 * StatChips row, whose diffstat was never wired (always +0/0). Every figure is
 * read once here from the live queries so it is NOT repeated in the scan cards
 * below (Command Deck remodel S3 — kills the cost-shown-5× / PR-shown-3×
 * duplication).
 */
export function IssueMetricStrip({ issueId }: { issueId: string }) {
  const prQuery = usePrQuery(issueId)
  const costsQuery = useIssueCostsQuery(issueId)
  const activityQuery = useActivityQuery(issueId)

  const metrics = useMemo<Metric[]>(() => {
    const pr = prQuery.data?.pr ?? null
    const costs = costsQuery.data
    const sections = activityQuery.data?.sections ?? []

    const cost = costs?.resolvedTotalCost ?? costs?.totalCost ?? 0
    const inTok = tokensShort(costs?.inputTokens)
    const outTok = tokensShort(costs?.outputTokens)
    const tokenSub = inTok && outTok ? `${inTok} in · ${outTok} out` : undefined

    const activeCount = sections.filter((s) => s.status === 'running' || s.status === 'active').length
    const lastStart = sections
      .map((s) => s.startedAt)
      .filter(Boolean)
      .sort()
      .at(-1)
    const lastRel = relativeFromNow(lastStart)

    const out: Metric[] = [
      {
        label: 'Cost to date',
        value: cost > 0 ? `$${cost.toFixed(2)}` : '—',
        sub: tokenSub,
      },
      {
        label: 'Diff',
        value: pr ? (
          <span>
            <span className="text-success-foreground">+{pr.additions}</span>{' '}
            <span className="text-destructive-foreground">−{pr.deletions}</span>
          </span>
        ) : (
          '—'
        ),
        sub: pr ? `${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'} changed` : undefined,
      },
      {
        label: 'Pull request',
        value: pr ? <span className="text-[15px]">#{pr.number}</span> : '—',
        sub: pr ? `${pr.isDraft ? 'draft' : pr.state.toLowerCase()}` : 'no PR',
      },
      {
        label: 'Sessions',
        value: String(sections.length),
        sub: `${activeCount} active agent${activeCount === 1 ? '' : 's'}`,
      },
      {
        label: 'Last activity',
        value: lastRel ? <span className="text-[15px]">{lastRel}</span> : '—',
        sub: lastRel ? 'ago' : undefined,
      },
    ]
    return out
  }, [prQuery.data, costsQuery.data, activityQuery.data])

  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="rounded-[14px] border border-border bg-card/40 px-3 py-2.5"
        >
          <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{m.label}</div>
          <div className="mt-0.5 font-mono text-[19px] font-semibold tabular-nums">{m.value}</div>
          {m.sub && <div className="mt-px text-[10px] text-muted-foreground">{m.sub}</div>}
        </div>
      ))}
    </div>
  )
}
