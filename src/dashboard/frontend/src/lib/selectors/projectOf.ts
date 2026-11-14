// Which project an issue or a conversation belongs to (PAN-5287 §6.6, WI-S7).
//
// One resolver for every count surface, so the needs-you and agents-working
// selectors file items under the same project the sidebar does.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRegisteredProjects } from '../../components/CommandDeck/UnknownProjectState'
import { fetchConversations } from '../../components/CommandDeck/ConversationList'
import { resolveEffectiveProjectKey, type RegisteredProjectLite } from '../../components/CommandDeck/projectsData'

/** A registered project with its issue prefix (GET /api/registered-projects sends `linearTeam`). */
export type ResolverProject = RegisteredProjectLite & { linearTeam?: string | null }

/** The conversation fields the selectors read (a subset of GET /api/conversations rows). */
export interface ConversationLike {
  name: string
  tmuxSession?: string | null
  cwd?: string | null
  projectKey?: string | null
  origin?: string | null
  gitOrigin?: string | null
  isWorking?: boolean
  title?: string | null
  issueId?: string | null
}

export interface ProjectResolver {
  issue(issueId: string): string | undefined
  conversation(name: string): string | undefined
}

const ISSUE_SUFFIX = /-\d+$/

export function buildProjectResolver(
  projects: readonly ResolverProject[],
  conversations: readonly ConversationLike[],
): ProjectResolver {
  return {
    issue(issueId) {
      if (!ISSUE_SUFFIX.test(issueId)) return undefined
      const prefix = issueId.replace(ISSUE_SUFFIX, '').toUpperCase()
      return projects.find((p) => p.linearTeam && p.linearTeam.toUpperCase() === prefix)?.key
    },
    conversation(name) {
      const conv = conversations.find(
        (c) => c.name === name || c.tmuxSession === name || c.tmuxSession === `conv-${name}`,
      )
      if (!conv) return undefined
      return resolveEffectiveProjectKey(conv, projects) ?? undefined
    },
  }
}

/** The resolver over the shared `['registered-projects']` and `['conversations']` queries. */
export function useProjectResolver(): ProjectResolver {
  const { data: projects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects })
  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  })
  return useMemo(
    () =>
      buildProjectResolver(
        Array.isArray(projects) ? (projects as ResolverProject[]) : [],
        Array.isArray(conversations) ? conversations : [],
      ),
    [projects, conversations],
  )
}
