import { useQuery } from '@tanstack/react-query'

import { selectIssues, useDashboardStore } from '../../lib/store'
import type { Issue } from '../../types'

export type IssueRecordStatus = 'ready' | 'loading' | 'not-found' | 'unavailable'
export interface IssueRecord { issue: Issue | null; status: IssueRecordStatus }

export const issueRecordQueryKey = (issueId: string) => ['issue', issueId.toUpperCase()] as const

/** Same match rule the drawer used (identifier or id, case-insensitive). */
export function findListedIssue(issues: readonly Issue[], issueId: string): Issue | null {
  const target = issueId.toLowerCase()
  return issues.find((issue) => issue.identifier.toLowerCase() === target || issue.id.toLowerCase() === target) ?? null
}

function isIssueRow(value: unknown): value is Issue {
  return typeof value === 'object' && value !== null
    && typeof (value as { identifier?: unknown }).identifier === 'string'
    && typeof (value as { title?: unknown }).title === 'string'
}

/** One issue from `GET /api/issues/:id`; null means the tracker says it does not exist (404). */
export async function fetchIssueRecord(issueId: string): Promise<Issue | null> {
  const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`issue read failed: ${res.status}`)
  const body: unknown = await res.json()
  if (!isIssueRow(body)) throw new Error('issue read returned a malformed row')
  return body
}

/**
 * One issue for a header (PAN-5171): the list entry if the store already has
 * it, else `GET /api/issues/:id`. The per-issue read covers issues the list
 * snapshot lacks (still loading, new, backlog/canceled, or aged-out) so a
 * header never waits on, or depends on, the full issue list.
 */
export function useIssueRecord(issueId: string | null): IssueRecord {
  const listed = useDashboardStore((s) => (issueId ? findListedIssue(selectIssues(s) as Issue[], issueId) : null))
  const query = useQuery({
    queryKey: issueRecordQueryKey(issueId ?? ''),
    queryFn: () => fetchIssueRecord(issueId as string),
    enabled: Boolean(issueId) && listed === null,
    staleTime: 30_000,
    retry: false,
  })
  if (!issueId) return { issue: null, status: 'unavailable' }
  if (listed) return { issue: listed, status: 'ready' }
  if (query.data) return { issue: query.data, status: 'ready' }
  if (query.data === null) return { issue: null, status: 'not-found' }
  if (query.isError) return { issue: null, status: 'unavailable' }
  return { issue: null, status: 'loading' }
}
