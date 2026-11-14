// Agents working: the one count of live, working sessions (PAN-5287 §6.6, D-9, WI-S5).
//
// Every surface that shows "N agents working" must use this selector, so they
// agree. A session counts once: an agent row whose id is `conv-<name>` is the
// same tmux session as the conversation whose tmuxSession is that id (the
// supervisor's lifecycle events use `conv-<name>` ids), and it is kept as one
// conversation row.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentSnapshot } from '@overdeck/contracts'
import { useDashboardStore, selectAgents } from '../store'
import { isRunningAgentStatus } from '../../components/AgentPillPopoverRow'
import { fetchConversations } from '../../components/CommandDeck/ConversationList'
import { useProjectResolver, type ConversationLike, type ProjectResolver } from './projectOf'

export type WorkingRole = 'planning' | 'building' | 'review' | 'test' | 'conversation' | 'other'

export interface WorkingRow {
  key: string
  kind: 'agent' | 'conversation'
  id: string
  label: string
  role: WorkingRole
  projectKey?: string
  issueId?: string
}

export interface AgentsWorking {
  count: number
  byRole: Record<WorkingRole, number>
  rows: WorkingRow[]
}

const WORKING_ROLES: readonly WorkingRole[] = ['planning', 'building', 'review', 'test', 'conversation', 'other']

type AgentLike = Pick<AgentSnapshot, 'id' | 'status' | 'role' | 'issueId'>

function agentRole(agent: AgentLike): WorkingRole {
  switch (agent.role) {
    case 'plan':
      return 'planning'
    case 'work':
      return 'building'
    case 'review':
      return 'review'
    case 'test':
      return 'test'
    case undefined:
      break
    default:
      return 'other'
  }
  if (agent.id.startsWith('planning-')) return 'planning'
  if (agent.id.startsWith('agent-')) return 'building'
  return 'other'
}

export function buildAgentsWorking(
  agents: readonly AgentLike[],
  conversations: readonly ConversationLike[],
  projectOf: ProjectResolver,
  opts?: { projectKey?: string },
): AgentsWorking {
  const conversationRow = (conv: ConversationLike): WorkingRow => {
    const projectKey = projectOf.conversation(conv.name)
    return {
      key: `conversation:${conv.name}`,
      kind: 'conversation',
      id: conv.name,
      label: conv.title || conv.name,
      role: 'conversation',
      ...(projectKey ? { projectKey } : {}),
      ...(conv.issueId ? { issueId: conv.issueId } : {}),
    }
  }
  const rows: WorkingRow[] = []
  const conversationSessions = new Set<string>()

  for (const conv of conversations) {
    if (conv.isWorking !== true) continue
    if (conv.tmuxSession) conversationSessions.add(conv.tmuxSession)
    rows.push(conversationRow(conv))
  }

  const conversationByTmux = new Map(
    conversations.filter((c) => c.tmuxSession).map((c) => [c.tmuxSession as string, c] as const),
  )
  for (const agent of agents) {
    if (!isRunningAgentStatus(agent.status)) continue
    if (agent.id.startsWith('conv-')) {
      // Already counted as a working conversation.
      if (conversationSessions.has(agent.id)) continue
      // A live conv-<name> agent whose conversation row exists is that conversation working.
      const conv = conversationByTmux.get(agent.id)
      if (conv) {
        conversationSessions.add(agent.id)
        rows.push(conversationRow(conv))
        continue
      }
    }
    const issueId = agent.issueId || undefined
    const projectKey = issueId ? projectOf.issue(issueId) : undefined
    rows.push({
      key: `agent:${agent.id}`,
      kind: 'agent',
      id: agent.id,
      label: issueId ?? agent.id,
      role: agentRole(agent),
      ...(projectKey ? { projectKey } : {}),
      ...(issueId ? { issueId } : {}),
    })
  }

  const kept = opts?.projectKey ? rows.filter((row) => row.projectKey === opts.projectKey) : rows
  const byRole = Object.fromEntries(WORKING_ROLES.map((role) => [role, 0])) as Record<WorkingRole, number>
  for (const row of kept) byRole[row.role] += 1
  return { count: kept.length, byRole, rows: kept }
}

/** The agents-working count over the store's agents and the shared `['conversations']` query. */
export function useAgentsWorking(opts?: { projectKey?: string }): AgentsWorking {
  const agents = useDashboardStore(selectAgents)
  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  })
  const projectOf = useProjectResolver()
  const projectKey = opts?.projectKey
  return useMemo(
    () => buildAgentsWorking(agents, Array.isArray(conversations) ? conversations : [], projectOf, { projectKey }),
    [agents, conversations, projectOf, projectKey],
  )
}
