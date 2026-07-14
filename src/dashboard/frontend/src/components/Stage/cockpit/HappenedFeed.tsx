/**
 * PAN-2398 — "What just happened": the cockpit's plain-language feed.
 * Sentences a non-technical reader understands, with task progress badges.
 * v1 derives from the issue's activity sections (session starts/finishes) and
 * the plan's task counts; it deepens to true domain-event sourcing later
 * without changing this surface.
 */

import { useQuery } from '@tanstack/react-query'
import { useActivityQuery, useReviewStatusQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'

interface FeedLine {
  at: string
  atMs: number
  text: string
  tone: 'ok' | 'bad' | 'info'
}

function compactModelName(model: string | undefined): string {
  if (!model || model === 'unknown') return 'a crew member'
  return model.replace(/^claude-/, '').replace(/-202\d{5,8}$/, '')
}

function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

const ROLE_VERB: Record<string, { doing: string; done: string }> = {
  planning: { doing: 'started planning what to build', done: 'finished the plan' },
  work: { doing: 'started writing code', done: 'finished its coding session' },
  strike: { doing: 'started an urgent fix', done: 'landed the urgent fix' },
  review: { doing: 'started reviewing the work', done: 'finished the review' },
  reviewer: { doing: 'started a review pass', done: 'finished a review pass' },
  test: { doing: 'started testing', done: 'finished testing' },
  merge: { doing: 'started merging', done: 'finished merging' },
  ship: { doing: 'started shipping', done: 'finished shipping' },
}

export function HappenedFeed({ issueId }: { issueId: string }) {
  const activity = useActivityQuery(issueId)
  const review = useReviewStatusQuery(issueId)
  const plan = useQuery<{ plan?: { items?: Array<{ status: string }> } }>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`)
      if (!res.ok) return {}
      return res.json()
    },
  })

  const items = plan.data?.plan?.items ?? []
  const doneCount = items.filter((item) => item.status === 'completed').length
  const progressBadge = items.length > 0 ? `${doneCount} of ${items.length}` : null

  const lines: FeedLine[] = []
  for (const section of activity.data?.sections ?? []) {
    // Pre-migration records surface as type 'legacy' with model 'unknown' —
    // "unknown started legacy" is noise, not news. Skip them.
    if (section.type === 'legacy') continue
    const verbs = ROLE_VERB[section.type] ?? { doing: `started ${section.type}`, done: `finished ${section.type}` }
    const who = compactModelName(section.model)
    const startMs = new Date(section.startedAt).getTime()
    lines.push({ at: clock(section.startedAt), atMs: startMs, text: `${who} ${verbs.doing}`, tone: 'info' })
    if (section.duration !== null && Number.isFinite(startMs)) {
      const endMs = startMs + (section.duration ?? 0)
      const failed = /fail|blocked|error/i.test(section.status ?? '')
      lines.push({
        at: clock(new Date(endMs).toISOString()),
        atMs: endMs,
        text: failed ? `${who} hit a problem — ${section.type} needs another pass` : `${who} ${verbs.done}`,
        tone: failed ? 'bad' : 'ok',
      })
    }
  }
  const rs = review.data
  if (rs?.reviewStatus === 'passed') lines.push({ at: '', atMs: Number.MAX_SAFE_INTEGER - 2, text: 'The reviewer approved the work ✓', tone: 'ok' })
  if (rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed') lines.push({ at: '', atMs: Number.MAX_SAFE_INTEGER - 2, text: 'The reviewer found problems — the crew is on it', tone: 'bad' })
  if (rs?.testStatus === 'passed') lines.push({ at: '', atMs: Number.MAX_SAFE_INTEGER - 1, text: 'All tests passed ✓', tone: 'ok' })
  if (rs?.mergeStatus === 'merged') lines.push({ at: '', atMs: Number.MAX_SAFE_INTEGER, text: 'Shipped — the change is on main ✓', tone: 'ok' })

  const recent = lines
    .filter((line) => Number.isFinite(line.atMs))
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, 8)

  if (recent.length === 0) return null

  return (
    <div className="rounded-[14px] border border-border bg-card p-4" data-testid="happened-feed">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-['Space_Grotesk'] text-[13.5px] font-semibold text-foreground">What just happened</div>
        {progressBadge && (
          <span className="rounded-md border border-border px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {progressBadge} tasks done
          </span>
        )}
      </div>
      <div>
        {recent.map((line, index) => (
          <div key={`${line.atMs}-${index}`} className="flex gap-2.5 border-b border-border py-2 text-[12.5px] last:border-b-0">
            <span className="w-[52px] shrink-0 font-['DM_Mono'] text-[11px] text-muted-foreground/70">{line.at}</span>
            <span className={line.tone === 'ok' ? 'text-foreground' : line.tone === 'bad' ? 'text-red-500' : 'text-muted-foreground'}>
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default HappenedFeed
