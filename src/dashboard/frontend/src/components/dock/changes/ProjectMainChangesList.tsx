// The Changes tab for a project root (PAN-5289 §6.4, FR-6): today on the
// default branch.
//
// GET /api/projects/:projectKey/changes?since=<local midnight> lists today's
// commits with who made them. A commit's files load when its group opens,
// from GET /api/diffs/compare on the project checkout. Uncommitted files of
// the main checkout come first, from the explorer's git status.

import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GitCommitHorizontal, Pencil } from 'lucide-react'
import type { ProjectChanges, ProjectCommit } from '@overdeck/contracts'

import { useExplorerGitStatus } from '../../explorer/git/useExplorerGitStatus'
import { useRootContext } from '../../explorer/rootForConversation'
import { useStageDeck } from '../../Stage/StageDeckContext'
import { useWorkDockStore, type DockDiffTarget } from '../workDockStore'
import { ChangeFileRow } from './ChangeFileRow'
import { ChangeGroup, ChangeTag, commitTime } from './ChangeGroup'

export interface ProjectMainChangesListProps {
  deckKey: string
  projectKey: string
}

/** ISO string of the local day start. */
export function localDayStartIso(now = new Date()): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? fallback)
  }
  return (await res.json()) as T
}

interface CompareFiles {
  files: Array<{ path: string; additions?: number; deletions?: number }>
}

function CommitFiles({
  repoPath,
  commit,
  row,
}: {
  repoPath: string
  commit: ProjectCommit
  row: (path: string, diff: DockDiffTarget, list: readonly DockDiffTarget[], additions?: number, deletions?: number) => ReactElement
}) {
  const query = useQuery({
    queryKey: ['project-commit-files', repoPath, commit.sha],
    queryFn: async () => {
      const url = `/api/diffs/compare?repo=${encodeURIComponent(repoPath)}&base=${encodeURIComponent(`${commit.sha}^`)}&head=${encodeURIComponent(commit.sha)}`
      return readJson<CompareFiles>(await fetch(url), "Couldn't load this commit's files")
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (query.isPending) return <p className="py-1 pl-8 text-xs text-muted-foreground">Loading files…</p>
  if (query.isError) return <p className="py-1 pl-8 text-xs text-destructive">Couldn't load files: {query.error.message}</p>
  const list = query.data.files.map((f) => ({ path: f.path, sha: commit.sha }))
  return <>{query.data.files.map((f, i) => row(f.path, list[i], list, f.additions, f.deletions))}</>
}

export function ProjectMainChangesList({ deckKey, projectKey }: ProjectMainChangesListProps) {
  const deck = useStageDeck()
  const rootId = `project:${projectKey}`
  const since = useMemo(() => localDayStartIso(), [])
  const repoPath = useRootContext().projects.find((p) => p.key === projectKey)?.path ?? null
  const git = useExplorerGitStatus(rootId)
  const query = useQuery({
    queryKey: ['project-changes', projectKey, since],
    queryFn: async () =>
      readJson<ProjectChanges>(
        await fetch(`/api/projects/${encodeURIComponent(projectKey)}/changes?since=${encodeURIComponent(since)}`),
        'Failed to load changes',
      ),
    staleTime: 4000,
  })

  const row = (path: string, diff: DockDiffTarget, list: readonly DockDiffTarget[], additions?: number, deletions?: number) => (
    <ChangeFileRow
      key={`${diff.sha ?? 'work'}:${path}`}
      path={path}
      additions={additions}
      deletions={deletions}
      rootPath={path}
      onDiff={() => useWorkDockStore.getState().openDock(deckKey, { tab: 'changes', diff, diffList: list })}
      onOpenBeside={() => deck?.openBeside?.({ rootId, path })}
      onReveal={() => useWorkDockStore.getState().openDock(deckKey, { tab: 'files', reveal: { rootId, path } })}
    />
  )

  const uncommitted = git.result?.entries ?? []
  const uncommittedList = uncommitted.map((e) => ({ path: e.path }))
  return (
    <div>
      {uncommitted.length > 0 && (
        <ChangeGroup
          label="Not committed yet"
          header={
            <>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-state-needs-you">Not committed yet</span>
            </>
          }
        >
          {uncommitted.map((e, i) => row(e.path, uncommittedList[i], uncommittedList))}
        </ChangeGroup>
      )}
      {query.isPending && <p className="px-3 py-3 text-xs text-muted-foreground">Loading today's commits…</p>}
      {query.isError && <p className="px-3 py-3 text-xs text-destructive">Couldn't load changes: {query.error.message}</p>}
      {query.data && query.data.commits.length === 0 && uncommitted.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">No commits on {query.data.branch} today.</p>
      )}
      {query.data?.commits.map((commit) => (
        <ChangeGroup
          key={commit.sha}
          label={`${commit.shortSha} ${commit.subject}`}
          defaultOpen={false}
          header={
            <>
              <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="shrink-0 font-mono text-[11.5px] text-primary-ink">{commit.shortSha}</span>
              <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
              <ChangeTag>{commit.by.title ?? commit.by.id ?? 'unattributed'}</ChangeTag>
              <span className="shrink-0 text-[11px] text-muted-foreground">{commitTime(commit.authoredAt)}</span>
            </>
          }
        >
          {repoPath ? (
            <CommitFiles repoPath={repoPath} commit={commit} row={row} />
          ) : (
            <p className="py-1 pl-8 text-xs text-muted-foreground">This project's folder is not known on this machine.</p>
          )}
        </ChangeGroup>
      ))}
    </div>
  )
}
