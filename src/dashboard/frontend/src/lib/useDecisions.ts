/**
 * useDecisions — the one enumeration of everything waiting on the operator.
 *
 * Decisions live in two domains that never met. Agents (and their permission
 * requests) arrive through the event store into the Zustand read model.
 * Conversations arrive over REST from `/api/conversations/pending-input`, and
 * until now only `usePendingInputDialogs` consumed them — to feed the modal and
 * nothing else. `selectPendingInputSubjects` reads `agentsById` alone, so the
 * "Needs you" list could not see a conversation, and neither could anything
 * built on it. The conversation domain is genuinely separate (conversations are
 * not rows in the agents table — verified: no live `conv-*` session appears in
 * listRunningAgents), so the join has to happen here, above both doors.
 *
 * Everything that shows the operator a decision reads this hook, so a question
 * cannot be visible in one surface and missing from another.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useDashboardStore,
  selectIssues,
  selectPendingInputSubjects,
  type PendingInputSubject,
} from './store';
import { fetchWithTimeout } from './apiFetch';
import { formatIssueRef } from './issueLabel';
import type { PendingPaneChoice } from './paneChoice';

/** A conversation with an open blocking surface, as served by the REST door. */
export interface ConversationPendingInputRow {
  name: string;
  title?: string | null;
  issueId?: string | null;
  pendingInputKinds?: ReadonlyArray<string>;
  pendingAskUserQuestion?: PendingInputSubject['pendingAskUserQuestion'];
  pendingProposedPlan?: PendingInputSubject['pendingProposedPlan'];
  /** PAN-3113 — a blocking numbered-choice menu parsed from the pane. */
  pendingPaneChoice?: PendingPaneChoice;
}

export type DecisionSource = 'agent' | 'conversation';

export interface Decision {
  /** The subject id `requestReopen` routes on: an agent id or a conversation name. */
  id: string;
  source: DecisionSource;
  /** What the operator recognizes this as — issue id, conversation title, or the raw id. */
  label: string;
  issueId?: string;
  issueTitle?: string;
  kinds: ReadonlyArray<string>;
  pendingAskUserQuestion?: PendingInputSubject['pendingAskUserQuestion'];
  pendingProposedPlan?: PendingInputSubject['pendingProposedPlan'];
  /** PAN-3113 — parsed pane choice menu, present on the paneChoice kind. */
  pendingPaneChoice?: PendingPaneChoice;
  /** Oldest blocking timestamp — drives ordering and the age column. */
  since: string;
  /**
   * True when an agent has stopped until this is answered, as opposed to work
   * continuing around it. This is what the operator triages on, so it groups the
   * list. A rate-limit modal, a question, or a permission prompt halts the turn
   * outright; a plan review does not necessarily.
   */
  blocking: boolean;
  /** The pending input prompt from the agent enrichment (for pending-input display). */
  pendingQuestionPrompt?: PendingInputSubject['pendingQuestionPrompt'];
  /** The pending input reason from the agent enrichment (for classification). */
  pendingQuestionReason?: PendingInputSubject['pendingQuestionReason'];
}

/**
 * Kinds that mean the agent has actually stopped and cannot proceed.
 *
 * PAN-3051 added `permissionRequest`. It was excluded on the reasoning that a
 * permission request "does not necessarily" halt the turn, which held while the
 * Channels bridge could answer one out-of-band. Under the PTY supervisor the
 * agent is parked on the `❯ Do you want to proceed?` modal in its own pane and
 * cannot advance a single tool call until a human picks an option — that is the
 * definition of blocking, and treating it as non-blocking sorted five frozen
 * agents below work that was still moving.
 */
const BLOCKING_KINDS = new Set([
  'askUserQuestion',
  'rateLimit',
  'sessionResume',
  // A pane choice menu (session-resume gate et al.) owns the session's input
  // loop — nothing advances until a human picks an option.
  'paneChoice',
  'agentTurnEnded',
  'permissionRequest',
  // PAN-3233 review fix — a paneQuestion (terminal prompt with no structured
  // payload) halts the turn exactly like an askUserQuestion; omitting it here
  // sorted these genuinely frozen agents into the non-blocking "Waiting" group.
  'paneQuestion',
]);

export function isBlockingDecision(kinds: ReadonlyArray<string>): boolean {
  return kinds.some((k) => BLOCKING_KINDS.has(k));
}

export function fetchConversationPendingInput(signal?: AbortSignal): Promise<ConversationPendingInputRow[]> {
  return fetchWithTimeout('/api/conversations/pending-input', { signal })
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => []);
}

/**
 * The same union in `PendingInputSubject` shape, as a drop-in for every consumer
 * of `selectPendingInputSubjects`. Those consumers carry real dedup and
 * answered/dismissed logic that must keep working — the only defect is that the
 * selector cannot see conversations, so widen the source rather than rewrite them.
 */
export function usePendingInputSubjects(): PendingInputSubject[] {
  const agentSubjects = useDashboardStore(selectPendingInputSubjects);
  const { data: convRows = [] } = useQuery({
    queryKey: ['conv-ask-user-question'],
    queryFn: ({ signal }) => fetchConversationPendingInput(signal),
    refetchInterval: 5000,
  });

  return useMemo(() => {
    const out: PendingInputSubject[] = [...agentSubjects];
    // The REST door can hand back a non-array (error body served with 200, a
    // shape change upstream). Iterating that throws inside a useMemo and takes
    // down every surface built on this hook, so coerce before the loop.
    for (const c of Array.isArray(convRows) ? convRows : []) {
      const kinds = c.pendingInputKinds?.length
        ? [...c.pendingInputKinds]
        : [
            ...(c.pendingAskUserQuestion ? ['askUserQuestion'] : []),
            ...(c.pendingProposedPlan ? ['exitPlanMode'] : []),
            ...(c.pendingPaneChoice ? ['paneChoice'] : []),
          ];
      if (kinds.length === 0) continue;
      out.push({
        agentId: c.name,
        issueId: c.issueId ?? undefined,
        kinds,
        pendingAskUserQuestion: c.pendingAskUserQuestion,
        pendingProposedPlan: c.pendingProposedPlan,
        permissionRequestIds: [],
        since: c.pendingAskUserQuestion?.askedAt ?? c.pendingProposedPlan?.askedAt ?? '',
      });
    }
    return out;
  }, [agentSubjects, convRows]);
}

export function useDecisions(): Decision[] {
  const agentSubjects = useDashboardStore(selectPendingInputSubjects);
  const issues = useDashboardStore(selectIssues);
  const titleByIssueId = useMemo(() => {
    const titles = new Map<string, string>();
    for (const issue of issues as Array<{ id?: string; title?: string }>) {
      if (issue?.id && issue.title) titles.set(issue.id, issue.title);
    }
    return titles;
  }, [issues]);

  // Same query key as usePendingInputDialogs so react-query dedupes the poll
  // rather than doubling it.
  const { data: convRows = [] } = useQuery({
    queryKey: ['conv-ask-user-question'],
    queryFn: ({ signal }) => fetchConversationPendingInput(signal),
    refetchInterval: 5000,
  });

  return useMemo(() => {
    const out: Decision[] = [];

    for (const s of agentSubjects) {
      const issueTitle = s.issueId ? titleByIssueId.get(s.issueId) : undefined;
      out.push({
        id: s.agentId,
        source: 'agent',
        label: formatIssueRef(s.issueId, issueTitle) ?? s.agentId,
        issueId: s.issueId,
        issueTitle,
        kinds: s.kinds,
        pendingAskUserQuestion: s.pendingAskUserQuestion,
        pendingProposedPlan: s.pendingProposedPlan,
        since: s.since,
        blocking: isBlockingDecision(s.kinds),
        pendingQuestionPrompt: s.pendingQuestionPrompt,
        pendingQuestionReason: s.pendingQuestionReason,
      });
    }

    for (const c of convRows) {
      // The REST door may report a payload without spelling out its kind; derive
      // the kind so a conversation is never dropped for lacking one.
      const kinds = c.pendingInputKinds?.length
        ? c.pendingInputKinds
        : [
            ...(c.pendingAskUserQuestion ? ['askUserQuestion'] : []),
            ...(c.pendingProposedPlan ? ['exitPlanMode'] : []),
            ...(c.pendingPaneChoice ? ['paneChoice'] : []),
          ];
      if (kinds.length === 0) continue;
      const issueTitle = c.issueId ? titleByIssueId.get(c.issueId) : undefined;
      out.push({
        id: c.name,
        source: 'conversation',
        label: c.title || c.name,
        issueId: c.issueId ?? undefined,
        issueTitle,
        kinds,
        pendingAskUserQuestion: c.pendingAskUserQuestion,
        pendingProposedPlan: c.pendingProposedPlan,
        pendingPaneChoice: c.pendingPaneChoice,
        since: c.pendingAskUserQuestion?.askedAt ?? c.pendingProposedPlan?.askedAt ?? '',
        blocking: isBlockingDecision(kinds),
      });
    }

    // Blocking first, then oldest first — the longest-stalled agent is the one
    // costing the most.
    out.sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      if (a.since === b.since) return a.id.localeCompare(b.id);
      return a.since.localeCompare(b.since);
    });
    return out;
  }, [agentSubjects, convRows, titleByIssueId]);
}
