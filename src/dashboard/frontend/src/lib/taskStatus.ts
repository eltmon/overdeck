/**
 * PAN-2696: the tasks endpoint serves raw vBRIEF items since the beads removal
 * (PAN-2648) — statuses are VBriefItemStatus values ('completed', 'running',
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
