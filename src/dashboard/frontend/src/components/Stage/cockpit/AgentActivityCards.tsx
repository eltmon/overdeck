import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, Loader2, Play, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDashboardStore } from '../../../lib/store'
import { useIssueData } from '../../drawer/useDrawerData'
import { useActivityQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { ModelHarnessPicker, useAvailableModels, type Harness } from '../../shared/ModelPicker'
import { refreshDashboardState } from '../../../lib/refresh-dashboard-state'
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'

const ACTIVE_STATES = new Set(['running', 'active', 'thinking', 'working'])

function agentTone(status: string): CockpitTone {
  if (ACTIVE_STATES.has(status)) return 'success'
  if (['stopped', 'failed', 'dead', 'error'].includes(status)) return 'muted'
  if (status === 'stuck') return 'destructive'
  return 'info'
}

type PlanningState = {
  hasPlan: boolean
  hasBeads: boolean
  planningComplete: boolean
}

type PlanningStatus = {
  active?: boolean
  planningCompleted?: boolean
  hasCompletionMarker?: boolean
}

async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string; hint?: string }
  return body.error ?? body.message ?? body.hint ?? fallback
}

function usePlanningReadiness(issueId: string) {
  const planningState = useQuery({
    queryKey: ['planning-state', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/planning-state`)
      if (!res.ok) throw new Error('Failed to load planning state')
      return res.json() as Promise<PlanningState>
    },
    staleTime: 10_000,
  })

  const planningStatus = useQuery({
    queryKey: ['planningStatus', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/planning/${issueId}/status`)
      if (!res.ok) throw new Error('Failed to load planning status')
      return res.json() as Promise<PlanningStatus>
    },
    staleTime: 10_000,
    refetchInterval: (query) => query.state.data?.active ? 10_000 : false,
  })

  return { planningState, planningStatus }
}

function AgentLaunchControl({
  issueId,
  canShowStart,
  canShowFinalize,
}: {
  issueId: string
  canShowStart: boolean
  canShowFinalize: boolean
}) {
  const queryClient = useQueryClient()
  const actions = useIssueActions(issueId)
  const { groups: modelGroups, defaultModel, harnessPolicy } = useAvailableModels()
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [model, setModel] = useState(defaultModel)
  const [harness, setHarness] = useState<Harness>('claude-code')

  useEffect(() => {
    if (defaultModel) setModel(defaultModel)
  }, [defaultModel])

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['planning-state', issueId] }),
      queryClient.invalidateQueries({ queryKey: ['planningStatus', issueId] }),
      queryClient.invalidateQueries({ queryKey: ['command-deck-planning', issueId] }),
      queryClient.invalidateQueries({ queryKey: ['beads', issueId] }),
      refreshDashboardState(queryClient),
    ])
  }

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/complete-planning`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: '{}',
      })
      if (!res.ok) throw new Error(await responseMessage(res, 'Failed to finalize planning'))
      return res.json().catch(() => ({ success: true }))
    },
    onSuccess: async () => {
      toast.success(`Planning finalized for ${issueId}`)
      await invalidate()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const startMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        issueId,
        projectId: actions.issue?.project?.id,
      }
      if (overrideEnabled) {
        payload.model = model
        payload.harness = harness
      }
      const res = await fetch('/api/agents', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await responseMessage(res, 'Failed to start agent'))
      return res.json().catch(() => ({ success: true }))
    },
    onSuccess: async () => {
      toast.success(`Starting work agent for ${issueId}`)
      await invalidate()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const busy = finalizeMutation.isPending || startMutation.isPending
  if (!canShowFinalize && !canShowStart) return null

  return (
    <div className="mt-3 border-t border-border pt-3">
      {canShowFinalize && (
        <button
          type="button"
          disabled={busy}
          onClick={() => finalizeMutation.mutate()}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-success px-2.5 py-1.5 text-[12px] font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
        >
          {finalizeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Finalize planning
        </button>
      )}

      {canShowStart && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => startMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {startMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Start agent
            </button>
            <button
              type="button"
              onClick={() => setOverrideOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent"
              aria-expanded={overrideOpen}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Overrides
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${overrideOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {overrideOpen && (
            <div className="rounded-[var(--radius-sm)] border border-border bg-muted/20 p-2.5">
              <label className="mb-2 flex items-center gap-2 text-[12px] text-foreground">
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={(event) => setOverrideEnabled(event.target.checked)}
                />
                Override default harness and model
              </label>
              {overrideEnabled ? (
                <div className="space-y-2">
                  <ModelHarnessPicker
                    model={model}
                    harness={harness}
                    onModelChange={setModel}
                    onHarnessChange={setHarness}
                    groups={modelGroups}
                    harnessPolicy={harnessPolicy}
                    modelLabel="Agent model"
                  />
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Default role routing will choose the work harness and model.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * AgentCard — the live agent for this issue (role · model · status), or a
 * "no active agent" prompt with the real spawn action. (Command Deck remodel S3.)
 */
export function AgentCard({ issueId }: { issueId: string }) {
  const drawerIssueId = useDashboardStore((s) => s.drawer.issueId)
  const { agents } = useIssueData(issueId ?? drawerIssueId)
  const actions = useIssueActions(issueId)
  const { planningState, planningStatus } = usePlanningReadiness(issueId)

  const live = agents.find((a) => ACTIVE_STATES.has(a.status)) ?? agents[0]
  const planning = planningState.data
  const status = planningStatus.data
  const hasPlan = planning?.hasPlan ?? actions.state.hasPlan
  const hasBeads = planning?.hasBeads ?? actions.state.hasBeads
  const canShowStart = !live && hasPlan && hasBeads
  const canShowFinalize = !live && hasPlan && !hasBeads && status?.hasCompletionMarker === true
  const spawn = ['doneWork', 'startAgent', 'resumeSession', 'recoverAgent']
    .map((key) => actions.all.find((v) => v.action.key === key))
    .find((v): v is IssueActionView => !!v && v.enabled && (v.action.key !== 'startAgent' || canShowStart))
  const readinessText = useMemo(() => {
    if (planningState.isLoading || planningStatus.isLoading) return 'Checking planning readiness...'
    if (!hasPlan) return 'No finalized vBRIEF yet.'
    if (!hasBeads && status?.hasCompletionMarker === true) return 'Planning is ready to finalize.'
    if (!hasBeads) return 'Waiting for planning to produce a final vBRIEF.'
    return 'vBRIEF and beads are ready.'
  }, [hasBeads, hasPlan, planningState.isLoading, planningStatus.isLoading, status?.hasCompletionMarker])

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
        <div className="text-[12px] text-muted-foreground">{readinessText}</div>
      )}
      {live ? spawn && (
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
      ) : (
        <AgentLaunchControl issueId={issueId} canShowStart={canShowStart} canShowFinalize={canShowFinalize} />
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
