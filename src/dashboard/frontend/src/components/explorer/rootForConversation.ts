// Which explorer root a conversation works in (PAN-5287 §6.4, WI-S4).
//
// Root ids: `project:<key>` (primary checkout), `issue:<ID>` (feature
// workspace), `workspace:<id>` (scratch edit workspace). `null` means the
// explorer cannot show this conversation's files: it runs on another machine,
// or its folder is outside every project. Child B renders those messages.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { resolvePathRoot } from '@overdeck/contracts'
import { fetchRegisteredProjects } from '../CommandDeck/UnknownProjectState'
import { useDashboardStore, selectIssues } from '../../lib/store'

export interface RootContext {
  /** GET /api/registered-projects */
  projects: readonly { key: string; name?: string; path: string; linearTeam?: string | null }[]
  /** GET /api/workspace-registry */
  workspaces: readonly { id: string; projectId: string; kind: 'main' | 'issue' | 'scratch'; name: string; issueId: string | null }[]
}

export interface RootConversation {
  cwd?: string | null
  issueId?: string | null
  workspaceId?: string | null
  origin?: string | null
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** Map a conversation to its explorer root id, or null (rules in §6.4, first match wins). */
export function rootIdForConversation(conv: RootConversation, ctx: RootContext): string | null {
  // 1. The explorer reads this machine's disk; a linked conversation runs elsewhere.
  if (conv.origin === 'linked') return null
  // 2. An issue conversation works in the issue's feature workspace.
  if (conv.issueId) return `issue:${conv.issueId.toUpperCase()}`
  // 3. A registered workspace row.
  if (conv.workspaceId) {
    const row = ctx.workspaces.find((w) => w.id === conv.workspaceId)
    if (row) {
      if (row.kind === 'scratch') return `workspace:${row.id}`
      if (row.kind === 'main') return `project:${row.projectId}`
      if (row.kind === 'issue' && row.issueId) return `issue:${row.issueId.toUpperCase()}`
    }
  }
  if (!conv.cwd) return null
  // 4-5. A feature workspace, else the primary checkout or any folder under
  // it (longest project path wins) — shared with explorerLocationForPath
  // (WI-7, PAN-5337), which also returns the root-relative path.
  return explorerLocationForPath(conv.cwd, ctx)?.rootId ?? null
}

/**
 * The explorer root and root-relative path of an absolute file path (rules 4-5 of
 * `rootIdForConversation`), or null. The rules are the shared `resolvePathRoot`
 * (PAN-5349); no scratch rows, since registry rows carry no path here.
 */
export function explorerLocationForPath(absPath: string, ctx: RootContext): { rootId: string; path: string } | null {
  const cwd = trimSlash(absPath)
  const hit = resolvePathRoot(cwd, ctx.projects, [])
  if (hit.kind !== 'root') return null
  const project = ctx.projects.find((p) => p.key === hit.projectKey)
  if (!project) return null
  const projectPath = trimSlash(project.path)
  // An issue root is <project>/workspaces/<first segment>; a project root is the project folder.
  const base = hit.rootId.startsWith('issue:')
    ? `${projectPath}/workspaces/${cwd.slice(projectPath.length + '/workspaces/'.length).split('/')[0]}`
    : projectPath
  return { rootId: hit.rootId, path: cwd === base ? '' : cwd.slice(base.length + 1) }
}

const TITLE_MAX = 40

function truncate(text: string): string {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

/** A human label for an explorer root id. */
export function rootLabelFor(rootId: string, ctx: RootContext & { issueTitles: ReadonlyMap<string, string> }): string {
  const sep = rootId.indexOf(':')
  if (sep <= 0) return rootId
  const kind = rootId.slice(0, sep)
  const value = rootId.slice(sep + 1)
  if (!value) return rootId
  if (kind === 'project') {
    const project = ctx.projects.find((p) => p.key === value)
    return project?.name || value
  }
  if (kind === 'issue') {
    const title = ctx.issueTitles.get(value)
    return title ? `${value} · ${truncate(title)}` : value
  }
  if (kind === 'workspace') {
    return ctx.workspaces.find((w) => w.id === value)?.name || 'Edit workspace'
  }
  return rootId
}

async function fetchWorkspaceRegistry(): Promise<RootContext['workspaces']> {
  const res = await fetch('/api/workspace-registry')
  if (!res.ok) return []
  const data = (await res.json()) as { workspaces?: unknown }
  return Array.isArray(data?.workspaces) ? (data.workspaces as RootContext['workspaces']) : []
}

/** Issue id → title, from the store's issue rows (`{ id, title }`, as SessionFeedSidebar and useDecisions read them). */
export function issueTitleMap(issues: readonly unknown[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const row of issues) {
    if (!row || typeof row !== 'object') continue
    const { id, title } = row as Record<string, unknown>
    if (typeof id === 'string' && id && typeof title === 'string' && title) titles.set(id.toUpperCase(), title)
  }
  return titles
}

/** The registered projects and workspace registry from the shared queries (empty until they load). */
export function useRootContext(): RootContext {
  const { data: projects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects })
  const { data: workspaces } = useQuery({
    queryKey: ['workspace-registry'],
    queryFn: fetchWorkspaceRegistry,
    refetchInterval: 10000,
  })
  return useMemo(
    () => ({
      projects: Array.isArray(projects) ? projects : [],
      workspaces: Array.isArray(workspaces) ? workspaces : [],
    }),
    [projects, workspaces],
  )
}

/** The label for `rootId` from the shared project, workspace and issue queries; null for a null root. */
export function useRootLabel(rootId: string | null): string | null {
  const rootContext = useRootContext()
  const issues = useDashboardStore(selectIssues)
  const issueTitles = useMemo(() => issueTitleMap(issues), [issues])
  return useMemo(() => {
    if (rootId === null) return null
    return rootLabelFor(rootId, { ...rootContext, issueTitles })
  }, [rootId, rootContext, issueTitles])
}
