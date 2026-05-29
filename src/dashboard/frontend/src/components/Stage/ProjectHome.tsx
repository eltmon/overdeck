import { useMemo } from 'react'
import type { Conversation } from '../CommandDeck/ConversationList'
import { HomePane } from './HomePane'
import { WorkspaceHeader } from './HomePane/WorkspaceHeader'
import { StatChips } from './HomePane/StatChips'
import { Launcher } from './HomePane/Launcher'
import { AgentDock } from './HomePane/AgentDock'
import { ActionDock } from './HomePane/ActionDock'
import { Timeline } from './HomePane/Timeline'
import { dispatchLauncherIntent } from './HomePane/launcherActions'
import { readLastUsedAgent, writeLastUsedAgent } from './HomePane/launcherOrdering'
import type { TimelineConversation } from './HomePane/timeline-utils'
import type { StageApi } from './types'

export interface ProjectHomeProps {
  /** Project key/name shown as `# <projectName>`. */
  projectName: string
  /** Project working branch; defaults to `main`. */
  branch?: string
  /** Conversations already scoped to this project. */
  conversations?: Conversation[]
  /** Create a conversation for this project, returning the new conversation's
   * name so the deck can open an agent tab on it. */
  onCreateConversation?: (agentId: string) => Promise<string | undefined>
  api: StageApi
}

/**
 * ProjectHome — the permanent HOME tab of a project-scoped deck (PAN-1561).
 * Reuses the PAN-1549 launch composition (Launcher, AgentDock, ActionDock,
 * Timeline, StatChips) verbatim; only the header (`# <project>` + `main`, via
 * WorkspaceHeader variant="project") and the data scope (the whole project, not
 * one issue) differ. Project diff/age stats are not available, so StatChips
 * degrades to neutral values and shows only the real conversation count.
 */
export function ProjectHome({
  projectName,
  branch = 'main',
  conversations = [],
  onCreateConversation,
  api,
}: ProjectHomeProps) {
  const timelineConversations: TimelineConversation[] = useMemo(
    () =>
      conversations.map((c) => ({
        id: c.name,
        agentLabel: c.title ?? c.model ?? 'Agent',
        timestamp: c.lastAttachedAt ?? c.createdAt,
        preview: c.title ?? undefined,
      })),
    [conversations],
  )

  const onAgentSelected = async (id: string) => {
    writeLastUsedAgent(api.deckKey, id)
    const conversationName = await onCreateConversation?.(id)
    if (conversationName) api.openOrFocusAgentPane(conversationName, 'Agent')
  }

  return (
    <HomePane
      workspaceId={api.deckKey}
      openPane={api.openPane}
      header={
        <>
          <WorkspaceHeader variant="project" name={projectName} branch={branch} />
          <StatChips conversationCount={conversations.length} />
        </>
      }
      launcher={
        <Launcher
          lastUsedAgentId={readLastUsedAgent(api.deckKey)}
          onSelect={(intent, query) =>
            dispatchLauncherIntent(intent, query, {
              openAgent: (i) => onAgentSelected(i.id),
              openTerminal: () => api.openTypedPane('terminal'),
              openWeb: (_q, url) =>
                api.openPane({ paneType: 'browser', label: 'Web', browserInitialUrl: url }),
              onAgentRun: (id) => writeLastUsedAgent(api.deckKey, id),
            })
          }
        />
      }
      agentDock={<AgentDock onSelectAgent={onAgentSelected} />}
      actionDock={
        // Project scope: only project-appropriate actions. Files/Commits/Plan/
        // Docs are issue-scoped and live on issue tabs (PAN-1561).
        <ActionDock
          actions={['terminal', 'browser']}
          onOpen={(t) =>
            t === 'terminal'
              ? api.toggleTerminal()
              : api.openPane({ paneType: 'browser', label: 'Web' })
          }
        />
      }
      timeline={
        <Timeline
          conversations={timelineConversations}
          onOpen={(id) => {
            const conv = conversations.find((c) => c.name === id)
            api.openOrFocusAgentPane(id, conv?.title ?? 'Agent')
          }}
        />
      }
    />
  )
}
