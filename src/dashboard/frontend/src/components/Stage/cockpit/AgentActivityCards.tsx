import { useDashboardStore } from '../../../lib/store'
import { useIssueData } from '../../drawer/useDrawerData'
import { useActivityQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'

const ACTIVE_STATES = new Set(['running', 'active', 'thinking', 'working'])

function agentTone(status: string): CockpitTone {
  if (ACTIVE_STATES.has(status)) return 'success'
  if (['stopped', 'failed', 'dead', 'error'].includes(status)) return 'muted'
  if (status === 'stuck') return 'destructive'
  return 'info'
}

/**
 * AgentCard — the live agent for this issue (role · model · status), or a
 * "no active agent" prompt with the real spawn action. (Command Deck remodel S3.)
 */
export function AgentCard({ issueId }: { issueId: string }) {
  const drawerIssueId = useDashboardStore((s) => s.drawer.issueId)
  const { agents } = useIssueData(issueId ?? drawerIssueId)
  const actions = useIssueActions(issueId)

  const live = agents.find((a) => ACTIVE_STATES.has(a.status)) ?? agents[0]
  const spawn = ['doneWork', 'startAgent', 'resumeSession', 'recoverAgent']
    .map((key) => actions.all.find((v) => v.action.key === key))
    .find((v): v is IssueActionView => !!v && v.enabled)

  return (
    <CockpitCard tone="success" title="Agent">
      {live ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-[12px] text-foreground">{live.id}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{live.model ?? '—'}</div>
          </div>
          <CockpitPill tone={agentTone(live.status)}>{live.status}</CockpitPill>
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">No agent for this issue.</div>
      )}
      {spawn && (
        <div className="mt-3">
          <button
            type="button"
            disabled={spawn.isPending}
            onClick={spawn.invoke}
            className="inline-flex items-center rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {spawn.action.label}
          </button>
        </div>
      )}
    </CockpitCard>
  )
}

function activityDot(status: string): string {
  if (ACTIVE_STATES.has(status)) return 'bg-info'
  if (['done', 'completed', 'passed', 'merged'].includes(status)) return 'bg-success'
  if (['failed', 'error', 'blocked'].includes(status)) return 'bg-destructive'
  return 'bg-muted-foreground'
}

/**
 * ActivityCard — a compact, live view of the most recent issue sessions (role ·
 * model · status), sourced from the authoritative activity API so it stays
 * consistent regardless of store hydration. The full feed lives in the Activity
 * dig tab. (Command Deck remodel S3.)
 */
export function ActivityCard({ issueId, onOpenFull }: { issueId: string; onOpenFull?: () => void }) {
  const activity = useActivityQuery(issueId)
  const sections = activity.data?.sections ?? []
  const items = [...sections].reverse().slice(0, 6)

  return (
    <CockpitCard
      tone="warning"
      title="Activity"
      right={
        onOpenFull ? (
          <button type="button" onClick={onOpenFull} className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground">
            full feed
          </button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">
          {activity.isLoading ? 'Loading…' : 'No activity yet.'}
        </div>
      ) : (
        <div className="flex flex-col">
          {items.map((s) => (
            <div key={s.sessionId} className="flex items-center gap-2.5 border-b border-border py-1.5 text-[11.5px] last:border-b-0">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${activityDot(s.status)}`} />
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                <span className="text-foreground">{s.role ?? s.type}</span>
                <span className="text-muted-foreground"> · {s.model}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{s.status}</span>
            </div>
          ))}
        </div>
      )}
    </CockpitCard>
  )
}
