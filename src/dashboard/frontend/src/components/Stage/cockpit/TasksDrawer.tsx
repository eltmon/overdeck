import { useEffect } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { TaskStatusRollup } from '../../../lib/taskStatus'
import { TasksRail, type TasksResponse, type TaskTask } from './TasksRail'
import styles from './cockpitBody.module.css'

interface TasksDrawerProps {
  issueId: string
  open: boolean
  query: UseQueryResult<TasksResponse>
  rollup: TaskStatusRollup<TaskTask>
  onClose: () => void
  onOpenFull: () => void
}

export function TasksDrawer({ issueId, open, query, rollup, onClose, onOpenFull }: TasksDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className={styles.tasksDrawerLayer}>
      <button
        type="button"
        aria-label="Close plan progress"
        className={styles.tasksDrawerScrim}
        onClick={onClose}
      />
      <aside role="dialog" aria-modal="true" aria-label="Plan progress" className={styles.tasksDrawer}>
        <div className={styles.tasksDrawerHeader}>
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Plan progress</div>
            <div className="mt-1 text-[14px] font-medium text-foreground">Tasks</div>
          </div>
          <button
            type="button"
            aria-label="Close tasks drawer"
            className="rounded-[var(--radius-sm)] border border-border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className={styles.tasksDrawerBody}>
          <TasksRail
            issueId={issueId}
            query={query}
            rollup={rollup}
            onOpenFull={() => {
              onClose()
              onOpenFull()
            }}
          />
        </div>
      </aside>
    </div>
  )
}
