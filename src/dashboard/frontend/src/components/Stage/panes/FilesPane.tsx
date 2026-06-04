import { useQuery } from '@tanstack/react-query'
import { FileCode } from 'lucide-react'
import type { TurnDiffFileChange } from '../../chat/chat-types'
import { usePanesStore } from '../../../lib/panesStore'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

async function fetchChangedFiles(agentId: string): Promise<TurnDiffFileChange[]> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/diffs/vs-main`)
  if (!res.ok) throw new Error(`diff fetch failed: ${res.status}`)
  const body = (await res.json()) as { files?: TurnDiffFileChange[] }
  return body.files ?? []
}

/**
 * FilesPane — paneType='files' (PAN-1549). A minimal changed-files view sourced
 * from the agent's diff-vs-main (per D8 — not a full filesystem browser).
 * Clicking a file opens/focuses the Commits pane to view the diff. Real
 * filesystem browsing is a follow-up (#1550).
 */
export function FilesPane({ pane, ctx }: PaneWrapperProps) {
  // PAN-1561: project-scoped deck — the pane carries its issue's agent id.
  const agentId = pane.agentId ?? ctx.agentId
  const setActivePane = usePanesStore((s) => s.setActivePane)
  const { data: files = [], isLoading, isError } = useQuery({
    queryKey: ['stage-files-vs-main', agentId],
    queryFn: () => fetchChangedFiles(agentId as string),
    enabled: Boolean(agentId),
  })

  if (!agentId) {
    return <div className={styles.placeholder}>No agent workspace to inspect.</div>
  }
  if (isLoading) {
    return <div className={styles.placeholder}>Loading changed files…</div>
  }
  if (isError) {
    return <div className={styles.placeholder}>Couldn’t load changed files.</div>
  }
  if (files.length === 0) {
    return <div className={styles.placeholder}>No changed files vs main.</div>
  }

  // Open the Commits pane to view the diff, focusing an existing one rather
  // than stacking a duplicate on every file click.
  const openCommits = () => {
    const current = usePanesStore.getState().panesByWorkspace[ctx.workspaceId] ?? []
    const existing = current.find((p) => p.paneType === 'commits' && p.issueId === pane.issueId)
    if (existing) setActivePane(ctx.workspaceId, existing.paneId)
    else ctx.openPane({ paneType: 'commits', label: 'Commits', issueId: pane.issueId, agentId })
  }

  return (
    <div className={styles.filesPane}>
      {files.map((f) => (
        <button key={f.path} type="button" className={styles.fileRow} onClick={openCommits}>
          <FileCode size={14} />
          <span className={styles.filePath}>{f.path}</span>
          {(f.additions != null || f.deletions != null) && (
            <span className={styles.fileStat}>
              <span className={styles.chipAdd}>+{f.additions ?? 0}</span>{' '}
              <span className={styles.chipDel}>−{f.deletions ?? 0}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
