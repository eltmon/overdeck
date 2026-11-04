/**
 * Deft pipeline data hooks (PAN-4849 WI-6).
 *
 * The frontend learns "this issue runs on Deft" only from the batched
 * `GET /api/deft/issues` list (BD-11); `DerivedIssueState` does not carry it.
 * Cockpit surfaces read one issue's full state from `GET /api/issues/:id/deft`,
 * fetched only for a Deft issue.
 */
import type { DeftIssueState, DeftIssueSummary, DeftReviewCycle } from '@overdeck/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

export const DEFT_ISSUES_QUERY_KEY = ['deft-issues'] as const;
export const deftIssueQueryKey = (issueId: string) => ['deft', issueId.toUpperCase()] as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: await dashboardMutationJsonHeaders(url), body: JSON.stringify(body) });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status} — ${url}`);
  return payload;
}

export function useDeftIssues() {
  return useQuery({
    queryKey: DEFT_ISSUES_QUERY_KEY,
    queryFn: () => fetchJson<{ issues: DeftIssueSummary[] }>('/api/deft/issues'),
    refetchInterval: 30_000,
    // A failed list reads as "not Deft"; every issue menu shares this one query.
    retry: false,
  });
}

/** Whether `issueId` runs on Deft, with its summary row. */
export function useDeftIssueSummary(issueId: string): { isDeft: boolean; summary: DeftIssueSummary | null; isLoading: boolean } {
  const { data, isLoading } = useDeftIssues();
  const wanted = issueId.toUpperCase();
  // A malformed response reads as "not Deft" rather than breaking every card that asks.
  const rows = Array.isArray(data?.issues) ? data.issues : [];
  const summary = rows.find(row => row?.issueId?.toUpperCase() === wanted) ?? null;
  return { isDeft: summary !== null, summary, isLoading };
}

export function useDeftIssueState(issueId: string) {
  const { isDeft } = useDeftIssueSummary(issueId);
  return useQuery({
    queryKey: deftIssueQueryKey(issueId),
    queryFn: () => fetchJson<DeftIssueState>(`/api/issues/${encodeURIComponent(issueId)}/deft`),
    refetchInterval: 15_000,
    enabled: isDeft,
  });
}

/** Deft's review cycle for the issue's PR; polled slower than the state, because it reads forge data. */
export function useDeftReviewCycle(issueId: string) {
  const { isDeft } = useDeftIssueSummary(issueId);
  return useQuery({
    queryKey: [...deftIssueQueryKey(issueId), 'review-cycle'],
    queryFn: () => fetchJson<DeftReviewCycle>(`/api/issues/${encodeURIComponent(issueId)}/deft/review-cycle`),
    refetchInterval: 30_000,
    enabled: isDeft,
  });
}

export interface ResolveEscalationInput {
  escId: string;
  decision: 'approved' | 'denied' | 'answered' | 'dismissed';
  answer?: string;
  note?: string;
}

export function useResolveEscalation(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ escId, ...body }: ResolveEscalationInput) =>
      postJson<{ resolved: true; delivered: boolean; deliveryError?: string }>(
        `/api/issues/${encodeURIComponent(issueId)}/deft/escalations/${encodeURIComponent(escId)}/resolve`,
        body,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deftIssueQueryKey(issueId) }),
  });
}

export function useSignOffScope(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { scopePath: string; itemId: string }) =>
      postJson<{ result: 'signed' | 'not-needed' }>(`/api/issues/${encodeURIComponent(issueId)}/deft/scopes/signoff`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deftIssueQueryKey(issueId) }),
  });
}
