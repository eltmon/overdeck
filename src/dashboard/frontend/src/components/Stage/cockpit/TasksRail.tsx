import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'
import type { TaskStatusRollup } from '../../../lib/taskStatus'
import styles from './tasksRail.module.css'

/**
 * TasksRail — the compact at-a-glance progress view for the issue cockpit.
 * It renders inside the Tasks drawer as completed ✓ → working-now → upcoming.
 * The parent owns the existing `/api/issues/:id/tasks` query so the tab-band
 * chip and this detail view share one polling observer and one bucketing helper.
 *
 * The full list/graph (DAG) + per-task detail is preserved: `onOpenFull` opens
 * the existing Tasks panel in the main area.
 */

export interface TaskTask {
  id: string
  name?: string
  title?: string
  /** Raw xBRIEF item status ('planned' | 'running' | 'completed' | …); legacy beads values tolerated (PAN-2696). */
  status: string
  labels: string[]
  blockedBy: string[]
  blocks?: string[]
  createdAt?: string
  startedAt?: string
  closedAt?: string
}

export interface TasksResponse {
  issueId: string
  workspacePath: string
  tasks: TaskTask[]
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

const taskTitle = (task: TaskTask): string => task.title || task.name || task.id

/** How many earlier completed tasks to keep collapsed behind the "show N" toggle. */
const COMPLETED_PREVIEW = 3

function DifficultyBadge({ labels }: { labels: string[] }) {
  const difficulty = difficultyOf(labels)
  if (!difficulty) return null
  return <span className={styles.badge}>{difficulty}</span>
}

function BlockedNote({ blockedBy }: { blockedBy: string[] }) {
  if (!blockedBy?.length) return null
  return (
    <div className={styles.blocked}>⤷ blocked by {blockedBy.length} upstream task{blockedBy.length === 1 ? '' : 's'}</div>
  )
}

export function useTasksQuery(issueId: string): UseQueryResult<TasksResponse> {
  const queryClient = useQueryClient()
  const query = useQuery<TasksResponse>({
    queryKey: ['tasks', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/tasks`)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      return res.json() as Promise<TasksResponse>
    },
    refetchInterval: 10_000,
  })

  useEffect(() => {
    const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['tasks', issueId] }) }
    window.addEventListener('overdeck:tasks-freshness', invalidate)
    return () => window.removeEventListener('overdeck:tasks-freshness', invalidate)
  }, [issueId, queryClient])

  return query
}

export function TasksRail({
  onOpenFull,
  query,
  rollup,
}: {
  issueId: string
  onOpenFull: () => void
  query: UseQueryResult<TasksResponse>
  rollup: TaskStatusRollup<TaskTask>
}) {
  const [showAllCompleted, setShowAllCompleted] = useState(false)
  const { isLoading, refetch, isRefetching } = query
  const {
    doneTasks: done,
    workingTasks: working,
    upcomingTasks: upcoming,
    total,
    percentDone: pctDone,
    percentWorking: pctWorking,
  } = rollup

  const completedShown = showAllCompleted ? done : done.slice(Math.max(0, done.length - COMPLETED_PREVIEW))
  const hiddenCompleted = done.length - completedShown.length
  const now = new Date()

  return (
    <aside data-section="beads-panel-compact" className={styles.rail} aria-label="Tasks progress">
      <div className={styles.header}>
        <span className={styles.title}>Tasks</span>
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
          <button type="button" className={styles.iconBtn} title="Open full tasks / graph view" onClick={onOpenFull} aria-label="Open full tasks view">⌥</button>
          <button type="button" className={styles.iconBtn} title="Refresh" onClick={() => refetch()} aria-label="Refresh tasks" disabled={isRefetching}>⟳</button>
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

      {isLoading && <div className={styles.empty}>Loading tasks…</div>}

      {!isLoading && total === 0 && (
        <div className={styles.empty}>
          No tasks yet.
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
                {completedShown.map((task) => (
                  <button type="button" key={task.id} className={`${styles.task} ${styles.taskDone}`} onClick={onOpenFull} title={taskTitle(task)}>
                    <span className={styles.node}>✓</span>
                    <span className={styles.taskTitle}>{taskTitle(task)}</span>
                    <span className={styles.meta}><DifficultyBadge labels={task.labels} /></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {working.length > 0 && (
            <>
              <div className={`${styles.groupHeader} ${styles.groupHeaderActive}`}>working now</div>
              <div className={styles.spine}>
                {working.map((task) => (
                  <button type="button" key={task.id} className={`${styles.task} ${styles.taskActive}`} onClick={onOpenFull} title={taskTitle(task)}>
                    <span className={styles.node}><span className={styles.pulse} /></span>
                    <span className={styles.workingTag}><span className={styles.pulse} /> in progress</span>
                    <span className={styles.taskTitle}>{taskTitle(task)}</span>
                    {task.startedAt && (
                      <span className={styles.agentLine}>started {formatRelativeTime(task.startedAt, now)}</span>
                    )}
                    <span className={styles.meta}><DifficultyBadge labels={task.labels} /></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {upcoming.length > 0 && (
            <>
              <div className={styles.groupHeader}>{upcoming.length} upcoming</div>
              <div className={styles.spine}>
                {upcoming.map((task) => (
                  <button type="button" key={task.id} className={`${styles.task} ${styles.taskOpen}`} onClick={onOpenFull} title={taskTitle(task)}>
                    <span className={styles.node} />
                    <span className={styles.taskTitle}>{taskTitle(task)}</span>
                    <span className={styles.meta}><DifficultyBadge labels={task.labels} /></span>
                    <BlockedNote blockedBy={task.blockedBy} />
                  </button>
                ))}
              </div>
            </>
          )}

          {done.length === total && total > 0 && (
            <div className={styles.allDone}>✓ All planned tasks complete</div>
          )}
        </div>
      )}
    </aside>
  )
}
