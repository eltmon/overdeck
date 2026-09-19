import {
  useActivityQuery,
  usePrQuery,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { UatEnvironmentPanel } from '../../CommandDeck/UatEnvironmentPanel'
import { useDerivedIssueState } from '../../../lib/store'
import type { DerivedIssueState } from '../../../types'
import { IssueBlockerSpotlight } from './IssueBlockerSpotlight'
import { PickupGateCard } from './PickupGateCard'
import { CrewStage } from './CrewStage'
import { HappenedFeed } from './HappenedFeed'
import { PlanMapCard } from './PlanMapCard'
import type { CockpitTone } from './CockpitCard'
import type { SessionNode } from '@overdeck/contracts'

/** Tabs the Overview's inline links can navigate to (a subset of MissionTab —
 * kept narrow so this file never imports from IssueMissionControl). */
export type OverviewNavTab = 'code' | 'timeline'

function nextAction(issue: DerivedIssueState | undefined): string {
  switch (issue?.state) {
    case 'merged': return 'merged — close out'
    case 'closed': return 'closed'
    case 'ready': return 'merge to main'
    case 'changes-requested': return 'work agent fixes → re-review'
    case 'in-review': return issue.pr?.checks === 'red' ? 'fix the failing checks' : 'review in progress'
    case 'working': return 'finish the work, then open the PR'
    case 'planned': return 'start work'
    default: return 'plan it'
  }
}

const NOW_LABEL: Record<string, string> = {
  work: 'Work', strike: 'Strike', review: 'Review', reviewer: 'Reviewer',
  test: 'Test', ship: 'Ship', merge: 'Ship', planning: 'Plan', legacy: 'Plan',
}
const NOW_MODEL_PLACEHOLDERS = new Set(['', 'unknown', 'specialist', 'planning', 'idle', 'none'])
function nowModel(m: string | undefined): string {
  const v = (m ?? '').trim()
  return NOW_MODEL_PLACEHOLDERS.has(v.toLowerCase()) ? '' : v.replace(/^claude-/, '')
}

const NOW_DOT: Record<CockpitTone, string> = {
  info: 'bg-info', success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive',
  review: 'bg-signal-review', cost: 'bg-signal-cost', muted: 'bg-muted-foreground',
}

interface NowState { tone: CockpitTone; text: string; agentType?: string; agentLabel?: string }
export function deriveNow(issue: DerivedIssueState | undefined, active: { type: string; model?: string } | undefined): NowState {
  const label = active ? (NOW_LABEL[active.type] ?? active.type) : ''
  const model = active ? nowModel(active.model) : ''
  const agentLabel = active ? (model ? `${label.toLowerCase()} · ${model}` : label.toLowerCase()) : undefined
  if (issue?.state === 'merged') return { tone: 'success', text: 'Merged — ready to close out' }
  if (issue?.state === 'ready') return { tone: 'warning', text: 'Approved and green — waiting on you to merge' }
  if (issue?.state === 'changes-requested') {
    const onIt = active?.type === 'work'
    return {
      tone: 'destructive',
      text: onIt ? 'Changes requested — work agent is fixing it' : 'Changes requested — awaiting the work agent',
      ...(onIt ? { agentType: 'work', agentLabel } : {}),
    }
  }
  if (issue?.pr?.checks === 'red') return { tone: 'destructive', text: 'Checks are failing on the PR' }
  if (issue?.pr?.checks === 'pending') return { tone: 'info', text: 'Checks running' }
  if (active) return { tone: 'info', text: `${label} agent is working`, agentType: active.type, agentLabel }
  return { tone: 'muted', text: 'Idle' }
}

/** Lean Overview "Now" panel (PAN-1991 #9) — only what the header gates, the
 * Agents lane, and the tasks rail don't already show: what's happening, the next
 * action, the diff size, and the last few status events. No status grid. */
function NowPanel({ issueId, onTab, onOpenAgent }: { issueId: string; onTab: (tab: OverviewNavTab) => void; onOpenAgent: (type: string) => void }) {
  const issue = useDerivedIssueState(issueId)
  const pr = usePrQuery(issueId)
  const activity = useActivityQuery(issueId)
  const p = pr.data?.pr
  const sections = activity.data?.sections ?? []
  const active = sections.find((s) => s.status === 'running' || s.status === 'active' || s.status === 'starting')
  const hasWork = sections.some((s) => s.type === 'work')
  const now = deriveNow(issue, active)
  const lk = 'rounded-[8px] border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent'

  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
        <span className={`h-[9px] w-[9px] shrink-0 rounded-full ${NOW_DOT[now.tone]}`} />
        <span>{now.text}</span>
        {now.agentLabel && (
          <button type="button" onClick={() => now.agentType && onOpenAgent(now.agentType)} className="rounded-[6px] border border-info/40 bg-info/10 px-1.5 font-mono text-[11px] text-info-foreground">
            {now.agentLabel}
          </button>
        )}
      </div>
      <div className="mt-2.5 text-[12.5px]">
        <span className="text-muted-foreground">Next:</span> {nextAction(issue)}
        {p && <> · <span className="text-muted-foreground">diff</span> <span className="text-success-foreground">+{p.additions}</span> <span className="text-destructive-foreground">−{p.deletions}</span> · {p.changedFiles} file{p.changedFiles === 1 ? '' : 's'}</>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {hasWork && <button type="button" className={lk} onClick={() => onOpenAgent('work')}>Open work agent ↗</button>}
        {p && <button type="button" className={lk} onClick={() => onTab('code')}>Open diff →</button>}
        {p?.url && <a className={lk} href={p.url} target="_blank" rel="noreferrer">Open PR ↗</a>}
      </div>
    </div>
  )
}

/** Overview — crew, UAT environment, feed, plan map, blocker spotlight, Now panel (PAN-2398). */
type OverviewTabProps = { issueId: string; onTab: (tab: OverviewNavTab) => void; onOpenAgent: (type: string) => void; sessions?: readonly SessionNode[]; onSelectSession?: (session: SessionNode) => void }
export function OverviewTab({ issueId, onTab, onOpenAgent, sessions, onSelectSession }: OverviewTabProps) {
  return (
    <div className="space-y-3.5">
      {sessions && onSelectSession && <CrewStage sessions={sessions} onSelectSession={onSelectSession} />}
      <UatEnvironmentPanel issueId={issueId} />
      <HappenedFeed issueId={issueId} />
      <PlanMapCard issueId={issueId} />
      <IssueBlockerSpotlight issueId={issueId} />
      <NowPanel issueId={issueId} onTab={onTab} onOpenAgent={onOpenAgent} />
      <PickupGateCard issueId={issueId} />
    </div>
  )
}
