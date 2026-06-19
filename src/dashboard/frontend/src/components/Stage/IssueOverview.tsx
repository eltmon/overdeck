import { useMemo } from 'react'
import type { ViewMode } from '../chat/ConversationPanel'
import type { PaneType } from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import { Launcher } from './HomePane/Launcher'
import { AgentDock } from './HomePane/AgentDock'
import { ActionDock } from './HomePane/ActionDock'
import { Timeline } from './HomePane/Timeline'
import { IssueMissionControl } from './cockpit/IssueMissionControl'
import { dispatchLauncherIntent } from './HomePane/launcherActions'
import { readLastUsedAgent, writeLastUsedAgent } from './HomePane/launcherOrdering'
import type { TimelineConversation } from './HomePane/timeline-utils'
import type { StageApi } from './types'

export interface IssueOverviewProps {
  issueId: string
  /** Issue title for the header (falls back to the id). */
  title: string
  /** Feature branch; defaults to feature/<issueId>. */
  branch?: string
  /** Active project name for the cockpit breadcrumb (e.g. "overdeck"). */
  projectName?: string
  /** Issue creation time for the age stat chip. */
  createdAt?: number | string
  /** The issue's agent id — scopes Files/Commits panes to this issue's workspace. */
  agentId?: string
  /** All conversations; filtered to this issue. */
  conversations?: Conversation[]
  /** Create a conversation for this issue, returning the new conversation's
   * name so the deck can open an agent tab on it. */
  onCreateConversation?: (agentId: string, message?: string, viewMode?: ViewMode) => Promise<string | undefined>
  api: StageApi
}

/**
 * IssueOverview — the body of an `issue` tab in a project-scoped deck
 * (PAN-1561). This is the issue-scoped launch composition that used to be the
 * Stage's HOME pane (PAN-1549): issue header (icon + name + feature/<id>),
 * issue stats, launcher, agent/action docks, the issue's conversation timeline,
 * and the collapsible detail sections. Reuses the launch components verbatim —
 * only its scope (one issue) differs from ProjectHome.
 */
export function IssueOverview({
  issueId,
  title,
  branch,
  projectName,
  agentId,
  conversations = [],
  onCreateConversation,
  api,
}: IssueOverviewProps) {
  const issueConversations = useMemo(
    () =>
      conversations.filter((c) => (c.issueId ?? '').toUpperCase() === issueId.toUpperCase()),
    [conversations, issueId],
  )
  const timelineConversations: TimelineConversation[] = useMemo(
    () =>
      issueConversations.map((c) => ({
        id: c.name,
        agentLabel: c.title ?? c.model ?? 'Agent',
        timestamp: c.lastAttachedAt ?? c.createdAt,
        preview: c.title ?? undefined,
      })),
    [issueConversations],
  )

  const onAgentSelected = async (id: string, message?: string) => {
    writeLastUsedAgent(issueId, id)
    const conversationName = await onCreateConversation?.(id, message, 'terminal')
    if (conversationName) api.openOrFocusAgentPane(conversationName, 'Agent')
  }
  // PAN-1561: terminal actions open the drawer stacked below, not a tab.
  const openTerminal = () => api.toggleTerminal()

  // Issue-scoped action panes carry this issue's id (and agent for Files) so
  // they query the right workspace, not the project deck key.
  const ISSUE_PANE_LABELS: Partial<Record<PaneType, string>> = {
    files: 'Files', commits: 'Commits', plan: 'Plan', docs: 'Docs',
  }
  const onAction = (t: PaneType) => {
    if (t === 'terminal') return api.toggleTerminal()
    if (t === 'browser') return api.openPane({ paneType: 'browser', label: 'Web' })
    api.openPane({ paneType: t, label: ISSUE_PANE_LABELS[t] ?? 'Pane', issueId, agentId })
  }

  const launcher = (
    <Launcher
      lastUsedAgentId={readLastUsedAgent(issueId)}
      onSelect={(intent, query) =>
        dispatchLauncherIntent(intent, query, {
          openAgent: (i, query) => onAgentSelected(i.id, query),
          openTerminal,
          openWeb: (_q, url) =>
            api.openPane({ paneType: 'browser', label: 'Web', browserInitialUrl: url }),
          onAgentRun: (id) => writeLastUsedAgent(issueId, id),
        })
      }
    />
  )

  const timeline = (
    <Timeline
      conversations={timelineConversations}
      onOpen={(id) => {
        const conv = issueConversations.find((c) => c.name === id)
        api.openOrFocusAgentPane(id, conv?.title ?? 'Agent')
      }}
    />
  )

  return (
    <IssueMissionControl
      issueId={issueId}
      title={title}
      branch={branch ?? `feature/${issueId.toLowerCase()}`}
      projectName={projectName}
      launcher={launcher}
      agentDock={<AgentDock onSelectAgent={onAgentSelected} />}
      actionDock={<ActionDock onOpen={onAction} />}
      timeline={timeline}
      onOpenPane={onAction}
    />
  )
}
