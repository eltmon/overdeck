import { useMemo, useState } from 'react'
import { usePrQuery, usePrDiffQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import styles from './changedFilesView.module.css'

/**
 * ChangedFilesView (PAN-1991 #7) — the Code group's changed-files tree + per-file
 * diff. Files are grouped by directory (collapsible); clicking a file shows its
 * unified diff on the right (auto-opens the first file). Cockpit-only — the
 * shared PrDiffTab is left untouched. Data is the existing PR files[] + diff
 * string (usePrQuery / usePrDiffQuery); no new endpoint.
 */

interface FileEntry { path: string; additions: number; deletions: number }

const TYPE_LABEL: Record<string, string> = {
  ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', json: '{}',
  css: 'CSS', scss: 'CSS', md: 'MD', mdx: 'MD', yaml: 'YML', yml: 'YML',
  html: 'HTM', sh: 'SH', py: 'PY', go: 'GO', rs: 'RS', sql: 'SQL', toml: 'TOM',
  lock: 'LCK', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', svg: 'SVG', gif: 'IMG',
}
function fileType(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  return TYPE_LABEL[ext] ?? (ext ? ext.slice(0, 3).toUpperCase() : '·')
}
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i) : '' }

function Bar({ add, del }: { add: number; del: number }) {
  const total = add + del
  const g = total ? Math.round((add / total) * 100) : 0
  return (
    <span className={styles.bar}>
      <span className={styles.g} style={{ width: `${g}%` }} />
      <span className={styles.r} style={{ width: `${total ? 100 - g : 0}%` }} />
    </span>
  )
}

/** Split a unified git diff into per-file line arrays, keyed by the b/ path. */
function splitDiffByFile(diff: string | null | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!diff) return map
  let path = ''
  let lines: string[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (path) map.set(path, lines)
      lines = []
      const m = /\sb\/(.+)$/.exec(line)
      path = m ? m[1] : ''
    } else if (path) {
      lines.push(line)
    }
  }
  if (path) map.set(path, lines)
  return map
}

interface DiffRow { kind: 'hunk' | 'add' | 'del' | 'ctx'; n: number | null; text: string }
function toDiffRows(lines: string[]): DiffRow[] {
  const rows: DiffRow[] = []
  let newLine = 0
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const after = line.split('@@')[1] ?? ''
      const m = /\+(\d+)/.exec(after)
      newLine = m ? parseInt(m[1], 10) : newLine
      rows.push({ kind: 'hunk', n: null, text: line })
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'add', n: newLine++, text: line })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'del', n: null, text: line })
    } else if (
      line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ') ||
      line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('rename ') ||
      line.startsWith('similarity ') || line.startsWith('Binary ') || line.startsWith('old mode') || line.startsWith('new mode')
    ) {
      // git metadata — not part of the rendered hunk body
    } else {
      rows.push({ kind: 'ctx', n: newLine++, text: line })
    }
  }
  return rows
}

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className={styles.cnt}>
      {add ? <span className={styles.add}>+{add}</span> : null}
      {add && del ? ' ' : null}
      {del ? <span className={styles.del}>−{del}</span> : null}
    </span>
  )
}

export function ChangedFilesView({ issueId }: { issueId: string }) {
  const pr = usePrQuery(issueId)
  const diffQuery = usePrDiffQuery(issueId)
  const files: FileEntry[] = pr.data?.pr?.files ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const selectedPath = selected ?? files[0]?.path ?? null

  const groups = useMemo(() => {
    const byDir = new Map<string, FileEntry[]>()
    for (const f of files) {
      const d = dirName(f.path)
      if (!byDir.has(d)) byDir.set(d, [])
      byDir.get(d)!.push(f)
    }
    return [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [files])

  const diffByFile = useMemo(() => splitDiffByFile(diffQuery.data?.diff), [diffQuery.data?.diff])
  const selectedRows = useMemo(
    () => (selectedPath ? toDiffRows(diffByFile.get(selectedPath) ?? []) : []),
    [diffByFile, selectedPath],
  )
  const selectedFile = files.find((f) => f.path === selectedPath)

  if (pr.isLoading) {
    return <div className={styles.wrap}><div className={styles.loading}>Loading changed files…</div></div>
  }
  if (!pr.data?.pr) {
    return <div className={styles.wrap}><div className={styles.empty}>No pull request for this issue yet.</div></div>
  }

  const totalAdd = pr.data.pr.additions ?? files.reduce((s, f) => s + f.additions, 0)
  const totalDel = pr.data.pr.deletions ?? files.reduce((s, f) => s + f.deletions, 0)

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.title}>Changed files</span>
        <span className={styles.sum}><b>{files.length}</b> <span className={styles.files}>files</span> · <span className={styles.add}>+{totalAdd}</span> <span className={styles.del}>−{totalDel}</span></span>
        <span className={styles.acts}>
          <button type="button" className={styles.btn} onClick={() => setCollapsed(new Set(groups.map((g) => g[0]).filter(Boolean)))}>Collapse all</button>
          <button type="button" className={styles.btn} onClick={() => setCollapsed(new Set())}>Expand all</button>
          {pr.data.pr.url && <a className={styles.btn} href={pr.data.pr.url} target="_blank" rel="noreferrer">Open PR ↗</a>}
        </span>
      </div>
      <div className={styles.grid}>
        <div className={styles.tree}>
          {files.length === 0 && <div className={styles.empty}>No files changed.</div>}
          {groups.map(([dir, dirFiles]) => {
            const isCollapsed = collapsed.has(dir)
            const dAdd = dirFiles.reduce((s, f) => s + f.additions, 0)
            const dDel = dirFiles.reduce((s, f) => s + f.deletions, 0)
            return (
              <div key={dir || '__root'}>
                {dir && (
                  <button type="button" className={`${styles.row} ${styles.dirrow}`} onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(dir)) n.delete(dir); else n.add(dir); return n })}>
                    <span className={styles.car}>{isCollapsed ? '▸' : '▾'}</span>
                    <span className={styles.ftype}>📁</span>
                    <span className={styles.nm}><span className={styles.dirname}>{dir}</span></span>
                    <Bar add={dAdd} del={dDel} />
                    <Counts add={dAdd} del={dDel} />
                  </button>
                )}
                {!isCollapsed && dirFiles.map((f) => (
                  <button
                    type="button"
                    key={f.path}
                    className={`${styles.row} ${dir ? styles.fileIndent : ''} ${f.path === selectedPath ? styles.sel : ''}`}
                    onClick={() => setSelected(f.path)}
                    title={f.path}
                  >
                    <span className={styles.car} />
                    <span className={styles.ftype}>{fileType(f.path)}</span>
                    <span className={styles.nm}>{baseName(f.path)}</span>
                    <Bar add={f.additions} del={f.deletions} />
                    <Counts add={f.additions} del={f.deletions} />
                  </button>
                ))}
              </div>
            )
          })}
        </div>
        <div className={styles.diff}>
          {!selectedPath ? (
            <div className={styles.empty}>Select a file to view its diff<span className={styles.sub}>or “Open PR ↗” for the full review</span></div>
          ) : (
            <>
              <div className={styles.dhead}>
                <span className={styles.ftype}>{fileType(selectedPath)}</span>
                <span className={styles.path}>{selectedPath}</span>
                {selectedFile && <Counts add={selectedFile.additions} del={selectedFile.deletions} />}
              </div>
              {diffQuery.isLoading ? (
                <div className={styles.loading}>Loading diff…</div>
              ) : selectedRows.length === 0 ? (
                <div className={styles.empty}>No text diff for this file<span className={styles.sub}>(binary, renamed, or no line changes)</span></div>
              ) : (
                <div className={styles.lines}>
                  {selectedRows.map((row, i) => {
                    const cls = row.kind === 'hunk' ? styles.hunk : row.kind === 'add' ? styles.add : row.kind === 'del' ? styles.del : ''
                    return (
                      <div key={i} className={`${styles.dl} ${cls}`}>
                        <span className={styles.ln}>{row.n ?? ''}</span>
                        <span className={styles.tx}>{row.text}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
