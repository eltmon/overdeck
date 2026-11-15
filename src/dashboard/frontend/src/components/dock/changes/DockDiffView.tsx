// One file's diff in the Changes tab (PAN-5289 FR-7, §6.4 diff columns, B-D7).
//
// A committed file compares <sha>^..<sha> (GET /api/diffs/compare). A file
// committed on an issue branch compares the issue workspace against main
// through the issue's agent (GET /api/agents/:id/diffs/vs-main). An
// uncommitted file diffs its HEAD version against the working copy, read
// through the explorer (B-D7). Previous/next wrap; J and K step through the
// list while focus is not in a text field (§6.7).

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, ChevronUp, Columns2, LocateFixed } from 'lucide-react'
import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'

import { useShortcut, type ShortcutDef } from '../../../lib/shortcuts/registry'
import { useDashboardStore } from '../../../lib/store'
import { pickDefaultDrawerAgent, type SessionAgent } from '../../drawer/DrawerAgentSession'
import { explorerErrorCode, explorerErrorMessage, readFile } from '../../explorer/explorer-rpc'
import { useExplorerStore } from '../../explorer/explorerStore'
import { useRootContext } from '../../explorer/rootForConversation'
import { fileIconFor } from '../../explorer/tree/fileIcons'
import { baseName, parentPath } from '../../explorer/tree/explorer-tree-model'
import { PatchFiles } from '../../diff/PatchFiles'
import { useStageDeck } from '../../Stage/StageDeckContext'
import type { DockScope } from '../dockScope'
import { useWorkDockStore, type DockDiffTarget } from '../workDockStore'

export const TOO_LARGE_SENTENCE = 'This file is too large or binary to diff here.'
export const NO_FOLDER_SENTENCE = "Open this conversation's folder on this machine to see the diff"

export interface DockDiffViewProps {
  deckKey: string
  scope: DockScope
  list: readonly DockDiffTarget[]
  index: number
  onIndex(index: number): void
  onBack(): void
}

type DiffData = { kind: 'patch'; patch: string } | { kind: 'files'; files: FileDiffMetadata[] } | { kind: 'message'; text: string }

async function readJson(res: Response): Promise<{ diff?: string; error?: string }> {
  const body = (await res.json().catch(() => null)) as { diff?: string; error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body ?? {}
}

function issueOf(rootId: string | null): string | null {
  return rootId?.startsWith('issue:') ? rootId.slice('issue:'.length) : null
}

export function DockDiffView({ deckKey, scope, list, index, onIndex, onBack }: DockDiffViewProps) {
  const deck = useStageDeck()
  const target = list[index] ?? list[0]
  const rootId = scope.rootId
  const rootAbs = useExplorerStore((s) => (rootId ? (s.roots[rootId]?.dirs['']?.absPath ?? null) : null))
  const projects = useRootContext().projects
  const agentsById = useDashboardStore((s) => s.agentsById)
  const issueId = issueOf(rootId)
  const agentId = useMemo(() => {
    if (!issueId) return null
    const agents = (Object.values(agentsById ?? {}) as unknown as SessionAgent[]).filter((a) => a.issueId?.toLowerCase() === issueId.toLowerCase())
    return pickDefaultDrawerAgent(agents)?.id ?? null
  }, [agentsById, issueId])
  const projectPath = scope.changes.kind === 'project-main' ? (projects.find((p) => p.key === (scope.changes as { projectKey: string }).projectKey)?.path ?? null) : null

  const step = (delta: number) => {
    if (list.length === 0) return
    onIndex((index + delta + list.length) % list.length)
  }

  // J / K, registered while the view is mounted (not while typing).
  const stepRef = useRef(step)
  stepRef.current = step
  const nextDef = useMemo<ShortcutDef>(
    () => ({ id: 'dock.diff-next', keys: { mac: 'J', other: 'J' }, scope: 'not-editing', label: 'Next changed file', group: 'Files', run: () => stepRef.current(1) }),
    [stepRef],
  )
  const prevDef = useMemo<ShortcutDef>(
    () => ({ id: 'dock.diff-prev', keys: { mac: 'K', other: 'K' }, scope: 'not-editing', label: 'Previous changed file', group: 'Files', run: () => stepRef.current(-1) }),
    [stepRef],
  )
  useShortcut(nextDef)
  useShortcut(prevDef)

  const query = useQuery({
    queryKey: ['dock-diff', rootId, target?.path, target?.sha ?? null, target?.committedVsMain ?? false, target?.repoRoot ?? null, agentId],
    enabled: target !== undefined,
    staleTime: 4000,
    queryFn: async (): Promise<DiffData> => {
      if (!target) return { kind: 'message', text: '' }
      if (target.sha) {
        const repo = target.repoRoot ?? projectPath ?? rootAbs
        if (!repo) return { kind: 'message', text: "Couldn't load this diff: the repository folder is not known on this machine" }
        const file = target.repoPath ?? target.path
        const url = `/api/diffs/compare?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(`${target.sha}^`)}&head=${encodeURIComponent(target.sha)}&file=${encodeURIComponent(file)}`
        return { kind: 'patch', patch: (await readJson(await fetch(url))).diff ?? '' }
      }
      if (target.committedVsMain && issueId) {
        if (!agentId) return { kind: 'message', text: "Couldn't load this diff: no agent has worked on this issue" }
        const url = `/api/agents/${encodeURIComponent(agentId)}/diffs/vs-main?file=${encodeURIComponent(target.path)}`
        return { kind: 'patch', patch: (await readJson(await fetch(url))).diff ?? '' }
      }
      if (!rootId) return { kind: 'message', text: NO_FOLDER_SENTENCE }
      const work = await readFile(rootId, target.path)
      let head: string
      try {
        const committed = await readFile(rootId, target.path, 'HEAD')
        if (committed.kind !== 'text') return { kind: 'message', text: TOO_LARGE_SENTENCE }
        head = committed.text ?? ''
      } catch (e) {
        // A new file has no HEAD version: diff against nothing.
        if (explorerErrorCode(e) !== 'NOT_FOUND') throw e
        head = ''
      }
      if (work.kind !== 'text') return { kind: 'message', text: TOO_LARGE_SENTENCE }
      return { kind: 'files', files: [parseDiffFromFile({ name: target.path, contents: head }, { name: target.path, contents: work.text ?? '' })] }
    },
  })

  if (!target) return null
  const { Icon, label } = fileIconFor(target.path, 'file', false)
  const dir = parentPath(target.path)
  const canOpen = rootId !== null && !target.outsideRoot
  const openBeside = () => {
    if (rootId) deck?.openBeside?.({ rootId, path: target.path })
  }
  const reveal = () => {
    if (rootId) useWorkDockStore.getState().openDock(deckKey, { tab: 'files', reveal: { rootId, path: target.path } })
  }
  const shortSha = target.sha?.slice(0, 7)
  const tag = shortSha
    ? target.pushed === undefined
      ? shortSha
      : `${shortSha} · ${target.pushed ? 'pushed' : 'not pushed'}`
    : target.committedVsMain
      ? 'committed on the branch'
      : 'not committed'

  let body
  if (query.isPending) body = <p className="px-3 py-3 text-xs text-muted-foreground">Loading the diff…</p>
  else if (query.isError) body = <p className="px-3 py-3 text-xs text-destructive">Couldn't load this diff: {explorerErrorMessage(query.error)}</p>
  else if (query.data.kind === 'message') body = <p className="px-3 py-3 text-xs text-muted-foreground">{query.data.text}</p>
  else if (query.data.kind === 'patch') {
    body = query.data.patch.trim() ? <PatchFiles patch={query.data.patch} cacheScope="dock-diff" /> : <p className="px-3 py-3 text-xs text-muted-foreground">No changes in this file.</p>
  } else body = <PatchFiles files={query.data.files} cacheScope="dock-diff" />

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dock-diff-view">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1 text-xs">
        <button type="button" title="Back to the list" aria-label="Back to the list" onClick={onBack} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        {label ? <span className="w-5 shrink-0 font-mono text-[9px] text-muted-foreground">{label}</span> : <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-mono" title={target.path}>
          {dir && <span className="text-muted-foreground">{dir}/</span>}
          {baseName(target.path)}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground" data-testid="dock-diff-position">
          {index + 1}/{list.length}
        </span>
        <button type="button" title="Previous file (K)" aria-label="Previous file (K)" onClick={() => step(-1)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Next file (J)" aria-label="Next file (J)" onClick={() => step(1)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs">
        <span className="min-w-0 truncate rounded border border-border px-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground">{tag}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={openBeside}
            disabled={!canOpen}
            className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Columns2 className="h-3.5 w-3.5" aria-hidden />
            Open beside chat
          </button>
          <button
            type="button"
            title="Reveal in files"
            aria-label="Reveal in files"
            onClick={reveal}
            disabled={!canOpen}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <LocateFixed className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  )
}
