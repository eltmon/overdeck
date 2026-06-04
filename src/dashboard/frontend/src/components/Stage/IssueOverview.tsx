import { useMemo } from 'react'
import type { PaneType } from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import { HomePane } from './HomePane'
import { WorkspaceHeader } from './HomePane/WorkspaceHeader'
import { IssueStatusBand } from './IssueStatusBand'
import { Launcher } from './HomePane/Launcher'
import { AgentDock } from './HomePane/AgentDock'
import { ActionDock } from './HomePane/ActionDock'
import { Timeline } from './HomePane/Timeline'
import { IssueCockpitBody } from './cockpit/IssueCockpitBody'
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
  /** Issue creation time for the age stat chip. */
  createdAt?: number | string
  /** The issue's agent id — scopes Files/Commits panes to this issue's workspace. */
  agentId?: string
  /** All conversations; filtered to this issue. */
  conversations?: Conversation[]
  /** Create a conversation for this issue, returning the new conversation's
   * name so the deck can open an agent tab on it. */
  onCreateConversation?: (agentId: string) => Promise<string | undefined>
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

  const onAgentSelected = async (id: string) => {
    writeLastUsedAgent(issueId, id)
    const conversationName = await onCreateConversation?.(id)
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

  return (
    <HomePane
      workspaceId={api.deckKey}
      openPane={api.openPane}
      header={
        <>
          <WorkspaceHeader
            name={title}
            branch={branch ?? `feature/${issueId.toLowerCase()}`}
            iconLabel={title.charAt(0).toUpperCase()}
          />
          <IssueStatusBand issueId={issueId} />
        </>
      }
      launcher={
        <Launcher
          lastUsedAgentId={readLastUsedAgent(issueId)}
          onSelect={(intent, query) =>
            dispatchLauncherIntent(intent, query, {
              openAgent: (i) => onAgentSelected(i.id),
              openTerminal,
              openWeb: (_q, url) =>
                api.openPane({ paneType: 'browser', label: 'Web', browserInitialUrl: url }),
              onAgentRun: (id) => writeLastUsedAgent(issueId, id),
            })
          }
        />
      }
      agentDock={<AgentDock onSelectAgent={onAgentSelected} />}
      actionDock={<ActionDock onOpen={onAction} />}
      timeline={
        <Timeline
          conversations={timelineConversations}
          onOpen={(id) => {
            const conv = issueConversations.find((c) => c.name === id)
            api.openOrFocusAgentPane(id, conv?.title ?? 'Agent')
          }}
        />
      }
      detail={<IssueCockpitBody issueId={issueId} />}
    />
  )
}
