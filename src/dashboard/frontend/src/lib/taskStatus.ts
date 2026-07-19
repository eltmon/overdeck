/**
 * PAN-2696: the tasks endpoint serves raw xBRIEF items since the beads removal
 * (PAN-2648) — statuses are XBriefItemStatus values ('completed', 'running',
 * 'planned', …), not the old beads 'open'/'closed'/'in_progress'. Bucket both
 * vocabularies so every task view classifies items the same way.
 */
export type TaskStatusBucket = 'done' | 'working' | 'upcoming'

export function taskStatusBucket(status: string | undefined): TaskStatusBucket {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'closed':
    case 'cancelled':
      return 'done'
    case 'running':
    case 'in_progress':
    case 'in-progress':
      return 'working'
    default:
      return 'upcoming'
  }
}

export interface TaskStatusRollup<T> {
  done: number
  working: number
  upcoming: number
  total: number
  percentDone: number
  percentWorking: number
  doneTasks: T[]
  workingTasks: T[]
  upcomingTasks: T[]
}

export function taskStatusRollup<T extends { status?: string }>(tasks: readonly T[]): TaskStatusRollup<T> {
  const doneTasks: T[] = []
  const workingTasks: T[] = []
  const upcomingTasks: T[] = []

  for (const task of tasks) {
    const bucket = taskStatusBucket(task.status)
    if (bucket === 'done') doneTasks.push(task)
    else if (bucket === 'working') workingTasks.push(task)
    else upcomingTasks.push(task)
  }

  const done = doneTasks.length
  const working = workingTasks.length
  const total = tasks.length
  return {
    done,
    working,
    upcoming: upcomingTasks.length,
    total,
    percentDone: total ? Math.round((done / total) * 100) : 0,
    percentWorking: total ? Math.round((working / total) * 100) : 0,
    doneTasks,
    workingTasks,
    upcomingTasks,
  }
}
