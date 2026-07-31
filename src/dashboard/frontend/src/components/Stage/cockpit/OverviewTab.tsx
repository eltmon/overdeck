import {
  useActivityQuery,
  usePrQuery,
  useReviewStatusQuery,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { UatEnvironmentPanel } from '../../CommandDeck/UatEnvironmentPanel'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'
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

// PAN-1991 #5: gate dots follow the law — emerald=passing, red=failing,
// blue=running (a machine is working; was purple), neutral=pending/rest.
export function statusToTone(status: string | undefined | null): CockpitTone {
  const normalized = (status ?? '').toLowerCase()
  if (['passed', 'success', 'completed', 'merged', 'ready'].includes(normalized)) return 'success'
  if (['failed', 'blocked', 'dispatch_failed', 'timed_out', 'action_required', 'startup_failure', 'failure'].includes(normalized)) return 'destructive'
  if (['running', 'reviewing', 'testing', 'queued', 'merging', 'verifying', 'in_progress'].includes(normalized)) return 'info'
  if (['skipped', 'neutral', 'cancelled'].includes(normalized)) return 'muted'
  return 'warning'
}

function nextAction(rs: ReviewStatusData | undefined): string {
  if (!rs) return 'start work'
  if (rs.mergeStatus === 'merged') return 'merged — close out'
  if (rs.readyForMerge) return 'merge to main'
  if (rs.reviewStatus === 'blocked' || rs.reviewStatus === 'failed') return 'work agent fixes → re-review'
  if (rs.reviewStatus === 'reviewing') return 'review in progress'
  if (rs.testStatus === 'testing') return 'test in progress'
  if (rs.testStatus === 'failed' || rs.testStatus === 'dispatch_failed') return 'fix tests → re-run'
  if (rs.reviewStatus === 'passed' && rs.testStatus !== 'passed' && rs.testStatus !== 'skipped') return 'dispatch test'
  return 'awaiting pipeline'
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
function deriveNow(rs: ReviewStatusData | undefined, active: { type: string; model?: string } | undefined): NowState {
  const label = active ? (NOW_LABEL[active.type] ?? active.type) : ''
  const model = active ? nowModel(active.model) : ''
  const agentLabel = active ? (model ? `${label.toLowerCase()} · ${model}` : label.toLowerCase()) : undefined
  if (rs?.mergeStatus === 'merged') return { tone: 'success', text: 'Merged — ready to close out' }
  if (rs?.readyForMerge) return { tone: 'success', text: 'Review & tests passed — ready to merge' }
  if (rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed') {
    const onIt = active?.type === 'work'
    return { tone: 'destructive', text: onIt ? 'Review blocked — work agent is fixing it' : 'Review blocked — awaiting the work agent', agentType: onIt ? 'work' : undefined, agentLabel: onIt ? agentLabel : undefined }
  }
  if (rs?.testStatus === 'testing') return { tone: 'info', text: 'Tests running' }
  if (rs?.verificationStatus === 'running') return { tone: 'info', text: 'Verification running' }
  if (active) return { tone: 'info', text: `${label} agent is working`, agentType: active.type, agentLabel }
  return { tone: 'muted', text: 'Idle — awaiting the pipeline' }
}

/** Lean Overview "Now" panel (PAN-1991 #9) — only what the header gates, the
 * Agents lane, and the tasks rail don't already show: what's happening, the next
 * action, the diff size, and the last few status events. No status grid. */
function NowPanel({ issueId, onTab, onOpenAgent }: { issueId: string; onTab: (tab: OverviewNavTab) => void; onOpenAgent: (type: string) => void }) {
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const activity = useActivityQuery(issueId)
  const rs = review.data
  const p = pr.data?.pr
  const sections = activity.data?.sections ?? []
  const active = sections.find((s) => s.status === 'running' || s.status === 'active' || s.status === 'starting')
  const hasWork = sections.some((s) => s.type === 'work')
  const now = deriveNow(rs, active)
  const recent = [...(rs?.history ?? [])]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 3)
  const nowDate = new Date()
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
        <span className="text-muted-foreground">Next:</span> {nextAction(rs)}
        {p && <> · <span className="text-muted-foreground">diff</span> <span className="text-success-foreground">+{p.additions}</span> <span className="text-destructive-foreground">−{p.deletions}</span> · {p.changedFiles} file{p.changedFiles === 1 ? '' : 's'}</>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {hasWork && <button type="button" className={lk} onClick={() => onOpenAgent('work')}>Open work agent ↗</button>}
        {p && <button type="button" className={lk} onClick={() => onTab('code')}>Open diff →</button>}
        {p?.url && <a className={lk} href={p.url} target="_blank" rel="noreferrer">Open PR ↗</a>}
      </div>
      {recent.length > 0 && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <span>Recent activity</span>
            <button type="button" className="text-[10px] normal-case tracking-normal text-muted-foreground hover:text-foreground" onClick={() => onTab('timeline')}>→ Timeline</button>
          </div>
          {recent.map((h, i) => (
            <div key={`${h.type}-${h.timestamp}-${i}`} className="flex items-baseline gap-2.5 py-1 text-[12.5px]">
              <span className={`mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ${NOW_DOT[statusToTone(h.status)]}`} />
              <span className="capitalize">{h.type} {h.status}</span>
              <span className="ml-auto text-[10.5px] text-muted-foreground">{formatRelativeTime(h.timestamp, nowDate)}</span>
            </div>
          ))}
        </div>
      )}
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
