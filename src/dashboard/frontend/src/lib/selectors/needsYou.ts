// Needs you: the one list of things a human must act on (PAN-5287 §6.5, D-8, WI-S6).
//
// Every surface that counts or lists needs-you items must use this selector,
// so they agree. Sources, in order, each deduplicated by item key:
//   (a) pending input on agents and conversations (questions, plans, permissions);
//   (b) issues whose derived state says `attention: 'needs-you'`;
//   (c) the Flywheel's needs-you rows (a row naming an issue folds into it);
//   (d) every other decision (fleet rows, unreachable machines, disk alert,
//       harness updates, restart recovery, MCP sign-ins, connector notices,
//       agent requests, and any decision kind added later).

import { useMemo } from 'react'
import { needsYouTick, type DerivedIssueState } from '@overdeck/contracts'
import { useDashboardStore, selectIssues, type PendingInputSubject } from '../store'
import { usePendingInputSubjects, useDecisions, type Decision } from '../useDecisions'
import { useAskUserQuestionUiStore } from '../askUserQuestionUiStore'
import { navigateToDecisionSubject } from '../navigateToDecision'
import { openAgentRequestDialog } from '../agentRequestDialogStore'
import { describePendingInput } from '../pendingInput'
import { formatIssueRef } from '../issueLabel'
import { requestRevealNeedsYou } from '../flywheelReveal'
import { useFlywheelStatus } from '../flywheelApi'
import { navigateToIssue } from '../../components/AgentPillPopoverRow'
import { needsYouRows, type NeedsYouRow } from '../../components/flywheel/needsYouRows'
import { useProjectResolver, type ProjectResolver } from './projectOf'

export type NeedsYouKind = 'pending-input' | 'issue' | 'flywheel' | 'decision'

export interface NeedsYouItem {
  /** 'issue:<ID>' | 'conversation:<name>' | 'agent:<id>' | 'flywheel:<needsYouItemKey(text)>' | 'decision:<id>' */
  key: string
  kind: NeedsYouKind
  projectKey?: string
  title: string
  ask: string
  since?: string
  open(): void
  /** The pending-input subject behind the item, so a surface can render answer controls (S-D12). */
  subject?: PendingInputSubject
  /** The decision behind the item (S-D12). */
  decision?: Decision
}

export interface SubjectResolution {
  answeredToolUseIds: ReadonlySet<string>
  dismissedSubjectIds: ReadonlySet<string>
  resolvedPlanToolUseIds: ReadonlySet<string>
  dismissedPlanSubjectIds: ReadonlySet<string>
}

export interface NeedsYouSources {
  subjects: readonly PendingInputSubject[]
  resolution: SubjectResolution
  derived: Readonly<Record<string, DerivedIssueState>>
  /** needsYouRows(needsYouTick(status)): the current run's tick, else the previous run's (PAN-5666); else []. */
  flywheelRows: readonly NeedsYouRow[]
  decisions: readonly Decision[]
  issueTitles: ReadonlyMap<string, string>
  projectOf: ProjectResolver
}

/** Issue id (upper-cased) → title, from the store's `{ id, title }` issue rows. */
function issueTitleMap(issues: readonly unknown[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const row of issues as Array<{ id?: unknown; title?: unknown }>) {
    if (typeof row?.id === 'string' && row.id && typeof row.title === 'string' && row.title) {
      titles.set(row.id.toUpperCase(), row.title)
    }
  }
  return titles
}

const DEFAULT_ISSUE_ASK = 'Waiting on your input'
const ISSUE_ID_IN_TEXT = /\b[A-Z][A-Z0-9]+-\d+\b/

/**
 * The Needs-you resolution rule: a subject with an AskUserQuestion or plan
 * payload stays while any payload is unanswered and undismissed; a subject with
 * no payload stays until its subject is dismissed.
 */
export function isSubjectUnresolved(subject: PendingInputSubject, resolution: SubjectResolution): boolean {
  const toolUseId = subject.pendingAskUserQuestion?.toolUseId
  const planToolUseId = subject.pendingProposedPlan?.toolUseId
  const auqResolved =
    !toolUseId || resolution.answeredToolUseIds.has(toolUseId) || resolution.dismissedSubjectIds.has(subject.agentId)
  const planResolved =
    !planToolUseId ||
    resolution.resolvedPlanToolUseIds.has(planToolUseId) ||
    resolution.dismissedPlanSubjectIds.has(subject.agentId)
  const hasPayload = Boolean(toolUseId || planToolUseId)
  return hasPayload ? !(auqResolved && planResolved) : !resolution.dismissedSubjectIds.has(subject.agentId)
}

function subjectAsk(subject: PendingInputSubject, resolution: SubjectResolution): string {
  const toolUseId = subject.pendingAskUserQuestion?.toolUseId
  const planToolUseId = subject.pendingProposedPlan?.toolUseId
  const auqOpen =
    !!toolUseId && !resolution.answeredToolUseIds.has(toolUseId) && !resolution.dismissedSubjectIds.has(subject.agentId)
  const planOpen =
    !!planToolUseId &&
    !resolution.resolvedPlanToolUseIds.has(planToolUseId) &&
    !resolution.dismissedPlanSubjectIds.has(subject.agentId)
  return (
    (auqOpen ? subject.pendingAskUserQuestion?.questions?.[0]?.question : undefined) ??
    (planOpen ? 'Plan awaiting your approval' : undefined) ??
    subject.permissionSummary ??
    describePendingInput(subject.kinds)
  )
}

function openSubject(subject: PendingInputSubject): void {
  if (subject.source === 'conversation' && subject.permissionAnswerable === false) {
    navigateToDecisionSubject({ id: subject.agentId, source: 'conversation', view: 'terminal' })
    return
  }
  navigateToDecisionSubject({ id: subject.agentId, source: subject.source, issueId: subject.issueId })
  useAskUserQuestionUiStore.getState().requestReopen(subject.agentId)
}

/** D4: a conversation owner files under its own project, falling back to its issue; an agent owner files under its issue. */
function agentRequestProjectKey(request: NonNullable<Decision['agentRequest']>, projectOf: ProjectResolver): string | undefined {
  if (request.agentKind === 'conversation') {
    return projectOf.conversation(request.agentId) ?? (request.issueId ? projectOf.issue(request.issueId) : undefined)
  }
  return request.issueId ? projectOf.issue(request.issueId) : undefined
}

function agentRequestAsk(request: NonNullable<Decision['agentRequest']>): string {
  return request.kind === 'secret' ? `Secret requested: ${request.name}` : `Machine link requested: ${request.hint}`
}

function openFlywheel(): void {
  requestRevealNeedsYou()
  window.history.pushState({}, '', '/flywheel')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function buildNeedsYouItems(sources: NeedsYouSources, opts?: { projectKey?: string }): NeedsYouItem[] {
  const { resolution, issueTitles, projectOf } = sources
  const items = new Map<string, NeedsYouItem>()
  const issueTitle = (id: string): string => formatIssueRef(id, issueTitles.get(id)) ?? id
  const issueItem = (id: string, ask: string): NeedsYouItem => {
    const projectKey = projectOf.issue(id)
    return {
      key: `issue:${id}`,
      kind: 'issue',
      title: issueTitle(id),
      ask,
      open: () => navigateToIssue(id),
      ...(projectKey ? { projectKey } : {}),
    }
  }

  // (a) pending input
  for (const subject of sources.subjects) {
    if (!isSubjectUnresolved(subject, resolution)) continue
    const issueId = subject.issueId?.toUpperCase()
    const key = issueId
      ? `issue:${issueId}`
      : subject.source === 'conversation'
        ? `conversation:${subject.agentId}`
        : `agent:${subject.agentId}`
    if (items.has(key)) continue
    const projectKey = issueId
      ? projectOf.issue(issueId)
      : subject.source === 'conversation'
        ? projectOf.conversation(subject.agentId)
        : undefined
    items.set(key, {
      key,
      kind: 'pending-input',
      title: (issueId ? formatIssueRef(issueId, issueTitles.get(issueId)) : null) ?? subject.conversationTitle ?? subject.agentId,
      ask: subjectAsk(subject, resolution),
      open: () => openSubject(subject),
      subject,
      ...(subject.since ? { since: subject.since } : {}),
      ...(projectKey ? { projectKey } : {}),
    })
  }

  // (b) issue attention
  for (const [rawId, state] of Object.entries(sources.derived)) {
    if (state?.attention !== 'needs-you') continue
    const id = rawId.toUpperCase()
    if (!items.has(`issue:${id}`)) items.set(`issue:${id}`, issueItem(id, DEFAULT_ISSUE_ASK))
  }

  // (c) flywheel rows; lastTick.needsYou is never counted on its own.
  for (const row of sources.flywheelRows) {
    const match = ISSUE_ID_IN_TEXT.exec(row.text)
    if (match) {
      const key = `issue:${match[0]}`
      const existing = items.get(key)
      if (!existing) items.set(key, issueItem(match[0], row.text))
      else if (existing.ask === DEFAULT_ISSUE_ASK) items.set(key, { ...existing, ask: row.text })
      continue
    }
    const key = `flywheel:${row.key}`
    if (items.has(key)) continue
    items.set(key, { key, kind: 'flywheel', title: 'Flywheel', ask: row.text, open: openFlywheel })
  }

  // (d) every decision that is not a pending-input subject already covered by (a)
  const subjectIds = new Set(sources.subjects.map((s) => `${s.source}:${s.agentId}`))
  for (const decision of sources.decisions) {
    if (!decision.remote && subjectIds.has(`${decision.source}:${decision.id}`)) continue
    const key = `decision:${decision.id}`
    if (items.has(key)) continue
    const request = decision.agentRequest
    const projectKey = request ? agentRequestProjectKey(request, projectOf) : undefined
    items.set(key, {
      key,
      kind: 'decision',
      title: decision.label,
      ask: request ? agentRequestAsk(request) : decision.permissionSummary ?? decision.pendingQuestionPrompt ?? describePendingInput(decision.kinds),
      open: request ? () => openAgentRequestDialog(request.id) : () => navigateToDecisionSubject(decision),
      decision,
      ...(decision.since ? { since: decision.since } : {}),
      ...(projectKey ? { projectKey } : {}),
    })
  }

  const all = [...items.values()]
  const kept = opts?.projectKey ? all.filter((item) => item.projectKey === opts.projectKey) : all
  // Items with a `since` first, oldest first; then the rest in insertion order.
  const dated = kept.filter((item) => item.since).sort((a, b) => (a.since as string).localeCompare(b.since as string))
  return [...dated, ...kept.filter((item) => !item.since)]
}

/** The needs-you items from the shared pending-input, store, flywheel and decision sources. */
export function useNeedsYouItems(opts?: { projectKey?: string }): NeedsYouItem[] {
  const subjects = usePendingInputSubjects()
  const decisions = useDecisions()
  const answeredToolUseIds = useAskUserQuestionUiStore((s) => s.answeredToolUseIds)
  const dismissedSubjectIds = useAskUserQuestionUiStore((s) => s.dismissedSubjectIds)
  const resolvedPlanToolUseIds = useAskUserQuestionUiStore((s) => s.resolvedPlanToolUseIds)
  const dismissedPlanSubjectIds = useAskUserQuestionUiStore((s) => s.dismissedPlanSubjectIds)
  const derived = useDashboardStore((s) => s.derivedIssueStateByIssueId)
  const issues = useDashboardStore(selectIssues)
  const { data: flywheelStatus } = useFlywheelStatus({ refetchInterval: 30_000 })
  const projectOf = useProjectResolver()
  const projectKey = opts?.projectKey

  const issueTitles = useMemo(() => issueTitleMap(issues), [issues])
  // Before a fresh run's first tick, the previous run's open items stay listed (PAN-5666).
  const lastTick = flywheelStatus?.lastTick ?? null
  const previousRun = flywheelStatus?.previousRun
  const flywheelRows = useMemo(() => {
    const tick = needsYouTick({ lastTick, previousRun })
    return tick ? needsYouRows(tick) : []
  }, [lastTick, previousRun])

  return useMemo(
    () =>
      buildNeedsYouItems(
        {
          subjects,
          resolution: { answeredToolUseIds, dismissedSubjectIds, resolvedPlanToolUseIds, dismissedPlanSubjectIds },
          derived,
          flywheelRows,
          decisions,
          issueTitles,
          projectOf,
        },
        { projectKey },
      ),
    [
      subjects,
      answeredToolUseIds,
      dismissedSubjectIds,
      resolvedPlanToolUseIds,
      dismissedPlanSubjectIds,
      derived,
      flywheelRows,
      decisions,
      issueTitles,
      projectOf,
      projectKey,
    ],
  )
}
