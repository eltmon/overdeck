import type { ReactNode } from 'react'
import type { ProjectChanges, ProjectCommit } from '@overdeck/contracts'
import { cn } from '../../../lib/utils'
import type { AgentsWorking, WorkingRole } from '../../../lib/selectors/agentsWorking'
import type { NeedsYouItem } from '../../../lib/selectors/needsYou'

/** The API returns at most this many commits (MAX_PROJECT_COMMITS). */
const COMMIT_CAP = 500
const VIA_PR = /\(#\d+\)$/

export function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return '$0';
}

/** The Spend subline's today value: whole dollars from $10 up (mockup screen 2: "$43 today"). */
function formatTodayCost(cost: number): string {
  return cost >= 10 ? `$${Math.round(cost)}` : formatCost(cost)
}

export function landedSummary(commits: readonly ProjectCommit[]): { count: number; viaPrs: number; capped: boolean } {
  return {
    count: commits.length,
    viaPrs: commits.filter((commit) => VIA_PR.test(commit.subject)).length,
    capped: commits.length >= COMMIT_CAP,
  }
}

const ROLE_WORDS: ReadonlyArray<[WorkingRole, (n: number) => string]> = [
  ['planning', (n) => `${n} planning`],
  ['building', (n) => `${n} building`],
  ['review', (n) => `${n} reviewing`],
  ['test', (n) => `${n} testing`],
  ['conversation', (n) => `${n} ${n === 1 ? 'conversation' : 'conversations'}`],
  ['other', (n) => `${n} other`],
]

function agentsSub(agents: AgentsWorking): string {
  const parts = ROLE_WORDS.filter(([role]) => (agents.byRole[role] ?? 0) > 0).map(([role, word]) => word(agents.byRole[role]))
  return agents.count === 0 || parts.length === 0 ? 'none right now' : parts.join(' · ')
}

function inReviewSub(prNumbers: readonly number[]): string {
  if (prNumbers.length === 0) return '—'
  if (prNumbers.length === 1) return `PR #${prNumbers[0]}`
  if (prNumbers.length === 2) return `PR #${prNumbers[0]}, #${prNumbers[1]}`
  return `${prNumbers.length} PRs`
}

export interface HomeFactsProps {
  agents: AgentsWorking
  needsYou: readonly NeedsYouItem[]
  inReview: { count: number; prNumbers: number[] }
  changes: { data?: ProjectChanges; isLoading: boolean; isError: boolean }
  spend: { week: number; today: number } | null
  /** No issue prefix is known, so spend cannot be scoped to the project. */
  spendUnavailable: boolean
  onAgents: () => void
  onNeedsYou: () => void
  onInReview: () => void
  onLanded: () => void
  onSpend: () => void
}

function Fact({ label, value, sub, dotClass, valueClass, onClick }: {
  label: string
  value: ReactNode
  sub: string
  dotClass?: string
  valueClass?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-fact={label}
      className="min-w-0 border-r border-border px-4 py-3 text-left last:border-r-0 hover:bg-accent"
    >
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {dotClass && <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)} />}
        {label}
      </span>
      <span data-fact-value className={cn('mt-0.5 block text-[22px] font-semibold tracking-[-0.01em]', valueClass ?? 'text-foreground')}>
        {value}
      </span>
      <span data-fact-sub className="block truncate text-[11.5px] text-muted-foreground">{sub}</span>
    </button>
  )
}

/**
 * PAN-5294 G-D10 — the project Home facts row. Pure: ProjectHome passes the
 * shared selectors' results (the same counts the project switcher and the
 * Needs you panel show) and the Home data hooks' answers.
 */
export function HomeFacts({
  agents,
  needsYou,
  inReview,
  changes,
  spend,
  spendUnavailable,
  onAgents,
  onNeedsYou,
  onInReview,
  onLanded,
  onSpend,
}: HomeFactsProps) {
  const landed = changes.data ? landedSummary(changes.data.commits) : null
  const landedValue = changes.isError ? '—'
    : landed ? (landed.capped ? `${COMMIT_CAP}+` : String(landed.count))
    : '…'
  const landedSub = changes.isError ? 'unavailable'
    : landed ? (landed.viaPrs > 0 ? `${landed.viaPrs} via PRs` : 'commits go to main')
    : '…'

  return (
    <div
      role="group"
      aria-label="Project facts"
      className="grid overflow-hidden rounded-[10px] border border-border bg-card"
      style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
    >
      <Fact label="Agents working" value={agents.count} sub={agentsSub(agents)} dotClass="bg-state-live" onClick={onAgents} />
      <Fact
        label="Needs you"
        value={needsYou.length}
        sub={needsYou[0]?.ask ?? 'nothing waiting'}
        dotClass={needsYou.length > 0 ? 'bg-state-needs-you' : undefined}
        onClick={onNeedsYou}
      />
      <Fact label="In review" value={inReview.count} sub={inReviewSub(inReview.prNumbers)} onClick={onInReview} />
      <Fact label="Landed this week" value={landedValue} sub={landedSub} onClick={onLanded} />
      <Fact
        label="Spend this week"
        value={spendUnavailable ? '—' : spend ? formatCost(spend.week) : '…'}
        sub={spendUnavailable ? 'needs an issue prefix' : spend ? `${formatTodayCost(spend.today)} today` : '…'}
        valueClass={spendUnavailable ? undefined : 'text-signal-cost-foreground'}
        onClick={onSpend}
      />
    </div>
  )
}
