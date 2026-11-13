import type { IssueRecordStatus } from './useIssueRecord'

/**
 * The inside of an issue header (PAN-5171): the title, a neutral skeleton
 * while no source has answered, or the identifier with a short hint when the
 * per-issue read failed. Never a placeholder string. Callers own the
 * heading element and its typography.
 */
export function IssueHeaderTitle({ issueId, title, status }: { issueId: string; title: string | null; status: IssueRecordStatus }) {
  if (title) return <>{title}</>
  if (status === 'loading') {
    return (
      <>
        <span aria-hidden="true" data-testid="issue-title-skeleton" className="inline-block h-[0.8em] w-[18ch] max-w-full animate-pulse rounded-[var(--radius-sm)] bg-muted align-middle" />
        <span className="sr-only">Loading issue title</span>
      </>
    )
  }
  return (
    <>
      {issueId}
      <span data-testid="issue-title-hint" className="ml-[8px] align-middle font-sans text-[11px] font-normal tracking-normal text-muted-foreground">
        {status === 'not-found' ? 'not found on tracker' : 'title unavailable'}
      </span>
    </>
  )
}
