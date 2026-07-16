import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatRelativeTime } from '../../lib/formatRelativeTime'
import { cn } from '../../lib/utils'
import styles from '../Stage/cockpit/tasksRail.module.css'

/**
 * BeadsRail — the persistent at-a-glance progress column for the issue cockpit
 * (PAN-1991 item #1). Beads moved out of the tab strip into a vertical rail:
 * completed ✓ → working-now (in_progress, blue) → upcoming. All data comes from
 * the existing `/api/issues/:id/beads` endpoint (same query key as
 * BeadsTasksPanel, so the cache is shared and there is no extra fetch).
 *
 * The full list/graph (DAG) + per-bead detail is preserved: `onOpenFull` opens
 * the existing Beads panel in the main area. The rail is the glance; that is the
 * drill-down.
 */

interface BeadTask {
  id: string
  name?: string
  title?: string
  /** Raw vBRIEF task status; legacy beads values remain tolerated. */
  status: string
  labels: string[]
  blockedBy: string[]
  blocks?: string[]
  createdAt?: string
  startedAt?: string
  closedAt?: string
}

interface BeadsResponse {
  issueId: string
  workspacePath: string
  tasks: BeadTask[]
  lastSyncedAt: string | null
  freshnessAgeMs: number | null
  stale: boolean
  syncError: string | null
}

export interface BeadsPanelItem {
  id: string
  title: string
  status: 'open' | 'current' | 'done'
  duration: string
}

const DIFFICULTIES = ['trivial', 'simple', 'medium', 'complex', 'expert']

function difficultyOf(labels: string[]): string | null {
  for (const label of labels) {
    const match = /^difficulty:(.+)$/i.exec(label)
    if (match) return match[1].toLowerCase()
  }
  for (const label of labels) {
    if (DIFFICULTIES.includes(label.toLowerCase())) return label.toLowerCase()
  }
  return null
}

const beadTitle = (bead: BeadTask): string => bead.title || bead.name || bead.id

/** How many earlier completed beads to keep collapsed behind the "show N" toggle. */
const COMPLETED_PREVIEW = 3

function DifficultyBadge({ labels }: { labels: string[] }) {
  const difficulty = difficultyOf(labels)
  if (!difficulty) return null
  return <span className={styles.badge}>{difficulty}</span>
}

function BlockedNote({ blockedBy }: { blockedBy: string[] }) {
  if (!blockedBy?.length) return null
  return (
    <div className={styles.blocked}>⤷ blocked by {blockedBy.length} upstream bead{blockedBy.length === 1 ? '' : 's'}</div>
  )
}

function DrawerStatusMarker({ status }: { status: BeadsPanelItem['status'] }) {
  if (status === 'done') {
    return (
      <span data-testid="drawer-bead-status-done" className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success text-[9px] font-bold leading-none text-white">
        ✓
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span data-testid="drawer-bead-status-current" className="relative flex h-[18px] w-[18px] items-center justify-center">
        <span className="drawer-bead-current-ping absolute h-[18px] w-[18px] rounded-full border-[1.5px] border-info" />
        <span className="h-[10px] w-[10px] rounded-full bg-info" />
      </span>
    )
  }
  return <span data-testid="drawer-bead-status-open" className="h-[18px] w-[18px] rounded-full border border-border bg-background/60" />
}

function DrawerBeads({ items }: { items: BeadsPanelItem[] }) {
  return (
    <section data-component="drawer-beads-list" data-testid="drawer-beads-list" className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="border-b border-border px-[14px] py-[10px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Beads</div>
      {items.length === 0 ? (
        <div className="px-[14px] py-[16px] text-[12px] text-muted-foreground">No beads yet.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-[18px_1fr_auto_auto] items-center gap-[10px] px-[14px] py-[10px]">
              <DrawerStatusMarker status={item.status} />
              <span className={cn('min-w-0 truncate text-[12px] leading-[18px] text-foreground', item.status === 'done' && 'text-muted-foreground line-through decoration-[rgba(255,255,255,0.18)]')}>
                {item.title}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{item.id}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{item.duration}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function BeadsPanel({ issueId, onOpenFull = () => undefined, compact = false, items }: { issueId: string; onOpenFull?: () => void; compact?: boolean; items?: BeadsPanelItem[] }) {
  const queryClient = useQueryClient()
  const [showAllCompleted, setShowAllCompleted] = useState(false)
  const { data, isLoading, refetch, isRefetching } = useQuery<BeadsResponse>({
    queryKey: ['tasks', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/tasks`)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      return res.json() as Promise<BeadsResponse>
    },
    refetchInterval: 10_000,
  })
  useEffect(() => {
    const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['tasks', issueId] }) }
    window.addEventListener('overdeck:tasks-freshness', invalidate)
    return () => window.removeEventListener('overdeck:tasks-freshness', invalidate)
  }, [issueId, queryClient])

  const tasks = data?.tasks ?? []
  const done = tasks.filter((t) => t.status === 'closed' || t.status === 'completed')
  const working = tasks.filter((t) => t.status === 'in_progress' || t.status === 'running')
  const upcoming = tasks.filter((t) => !done.includes(t) && !working.includes(t))
  const total = tasks.length
  const pctDone = total ? Math.round((done.length / total) * 100) : 0
  const pctWorking = total ? Math.round((working.length / total) * 100) : 0

  const completedShown = showAllCompleted ? done : done.slice(Math.max(0, done.length - COMPLETED_PREVIEW))
  const hiddenCompleted = done.length - completedShown.length
  const now = new Date()

  if (compact) {
    return (
      <button type="button" data-section="beads-panel-compact" className={styles.count} onClick={onOpenFull} title={`${done.length} of ${total} beads complete`}>
        beads {done.length}/{total} · {pctDone}%
      </button>
    )
  }

  if (items) return <DrawerBeads items={items} />

  return (
    <aside data-section="beads-panel" className={styles.rail} aria-label="Beads progress">
      <div className={styles.header}>
        <span className={styles.title}>Beads</span>
        <span className={data?.stale ? styles.stale : styles.freshness} title={data?.syncError ?? undefined}>
          {data?.stale
            ? 'stale'
            : data?.lastSyncedAt
              ? `synced ${formatRelativeTime(data.lastSyncedAt, now)}`
              : 'not synced'}
        </span>
        <div className={styles.counts}>
          {total > 0 ? (
            <>
              <span className={styles.count} title="upcoming"><span className={`${styles.cdot} ${styles.open}`} />{upcoming.length}</span>
              {working.length > 0 && (
                <span className={styles.count} title="in progress"><span className={`${styles.cdot} ${styles.active}`} />{working.length}</span>
              )}
              <span className={styles.count} title="completed"><span className={`${styles.cdot} ${styles.done}`} />{done.length}</span>
            </>
          ) : (
            <span className={styles.muted}>—</span>
          )}
          <button type="button" className={styles.iconBtn} title="Open full beads / graph view" onClick={onOpenFull} aria-label="Open full beads view">⌥</button>
          <button type="button" className={styles.iconBtn} title="Refresh" onClick={() => refetch()} aria-label="Refresh beads" disabled={isRefetching}>⟳</button>
        </div>
      </div>

      {total > 0 && (
        <div className={styles.progressWrap}>
          <div className={styles.progressTop}>
            <span>Plan progress</span>
            <span><b>{done.length}</b> / {total} · {pctDone}%</span>
          </div>
          <div className={styles.track}>
            <div className={styles.fillDone} style={{ width: `${pctDone}%` }} />
            <div className={styles.fillActive} style={{ width: `${pctWorking}%` }} />
          </div>
        </div>
      )}

      {isLoading && <div className={styles.empty}>Loading beads…</div>}

      {!isLoading && total === 0 && (
        <div className={styles.empty}>
          No beads yet.
          <div className={styles.muted}>Planning hasn&rsquo;t created tasks for this issue.</div>
        </div>
      )}

      {!isLoading && total > 0 && (
        <div className={styles.body}>
          {done.length > 0 && (
            <>
              <div className={styles.groupHeader}>{done.length} completed</div>
              <div className={styles.spine}>
                {hiddenCompleted > 0 && !showAllCompleted && (
                  <button type="button" className={styles.more} onClick={() => setShowAllCompleted(true)}>
                    ↑ show {hiddenCompleted} earlier completed
                  </button>
                )}
                {completedShown.map((bead) => (
                  <button type="button" key={bead.id} className={`${styles.bead} ${styles.beadDone}`} onClick={onOpenFull} title={beadTitle(bead)}>
                    <span className={styles.node}>✓</span>
                    <span className={styles.beadTitle}>{beadTitle(bead)}</span>
                    <span className={styles.meta}><DifficultyBadge labels={bead.labels} /></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {working.length > 0 && (
            <>
              <div className={`${styles.groupHeader} ${styles.groupHeaderActive}`}>working now</div>
              <div className={styles.spine}>
                {working.map((bead) => (
                  <button type="button" key={bead.id} className={`${styles.bead} ${styles.beadActive}`} onClick={onOpenFull} title={beadTitle(bead)}>
                    <span className={styles.node}><span className={styles.pulse} /></span>
                    <span className={styles.workingTag}><span className={styles.pulse} /> in progress</span>
                    <span className={styles.beadTitle}>{beadTitle(bead)}</span>
                    {bead.startedAt && (
                      <span className={styles.agentLine}>started {formatRelativeTime(bead.startedAt, now)}</span>
                    )}
                    <span className={styles.meta}><DifficultyBadge labels={bead.labels} /></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {upcoming.length > 0 && (
            <>
              <div className={styles.groupHeader}>{upcoming.length} upcoming</div>
              <div className={styles.spine}>
                {upcoming.map((bead) => (
                  <button type="button" key={bead.id} className={`${styles.bead} ${styles.beadOpen}`} onClick={onOpenFull} title={beadTitle(bead)}>
                    <span className={styles.node} />
                    <span className={styles.beadTitle}>{beadTitle(bead)}</span>
                    <span className={styles.meta}><DifficultyBadge labels={bead.labels} /></span>
                    <BlockedNote blockedBy={bead.blockedBy} />
                  </button>
                ))}
              </div>
            </>
          )}

          {done.length === total && total > 0 && (
            <div className={styles.allDone}>✓ All planned beads complete</div>
          )}
        </div>
      )}
    </aside>
  )
}
