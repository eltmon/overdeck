/**
 * PAN-2908 · C-BOARD — the "Needs you" strip.
 *
 * The only three states that need a human — pending questions, problems found
 * in review, stuck agents — surface above every column. Same derivation as
 * the simple-mode home (bucketSimpleHome), advanced-mode targets (opens the
 * issue drawer).
 */
import { useMemo, useState } from 'react';
import { useDashboardStore } from '../../lib/store';
import { usePendingInputSubjects } from '../../lib/useDecisions';
import type { Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { bucketSimpleHome, deriveSimpleIssue, type SimpleIssueDerivation, type NeedsYouKind } from '../../lib/simple/derive';
import { useSimpleActions } from '../../lib/simple/useSimpleActions';

const KIND_META: Record<NeedsYouKind, { label: string; tone: string }> = {
  question: { label: 'Question', tone: 'border-warning/40' },
  problems: { label: 'Problems found', tone: 'border-warning/40' },
  stuck: { label: 'Stuck', tone: 'border-destructive/40' },
};

function NeedsYouRow({
  item,
  kind,
  question,
  onOpen,
}: {
  item: SimpleIssueDerivation;
  kind: NeedsYouKind;
  question?: string;
  onOpen: (id: string) => void;
}) {
  const actions = useSimpleActions();
  const [answer, setAnswer] = useState('');
  const agent = item.primaryAgent;
  const questionAgent = item.pendingInputAgent;
  const busy = actions.tell.isPending || actions.recover.isPending || actions.unstick.isPending || actions.answer.isPending;
  const meta = KIND_META[kind];

  return (
    <div className={`flex-none w-[340px] rounded-xl border bg-card p-3 shadow-sm ${meta.tone}`} data-needs-you={item.issue.identifier}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{item.issue.identifier}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{meta.label}</span>
      </div>
      <button onClick={() => onOpen(item.issue.identifier)} className="mt-1 block w-full truncate text-left text-xs font-medium hover:underline">
        {item.issue.title}
      </button>
      <div className="mt-1 text-[11.5px] text-muted-foreground line-clamp-2">
        {kind === 'question' && question ? question : item.display.sentence}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {kind === 'question' && (
          <>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim() && questionAgent) actions.answer.mutate({ agentId: questionAgent.id, text: answer.trim() }); }}
              placeholder="Type your answer…"
              className="h-7 flex-1 rounded-md border border-input bg-muted px-2 text-[11.5px] text-foreground outline-none focus:border-ring"
            />
            <button
              disabled={!answer.trim() || !questionAgent || busy}
              onClick={() => questionAgent && actions.answer.mutate({ agentId: questionAgent.id, text: answer.trim() })}
              className="h-7 flex-none rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
            >
              Answer
            </button>
          </>
        )}
        {kind === 'problems' && (
          <button
            disabled={!agent || busy}
            onClick={() => agent && actions.tell.mutate({ agentId: agent.id, message: 'Please address the review findings and get this back to green.' })}
            className="h-7 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
          >
            Tell the agent to fix them
          </button>
        )}
        {kind === 'stuck' && (
          <button
            disabled={busy || (!item.reviewStuck && !agent)}
            onClick={() => {
              if (item.reviewStuck) actions.unstick.mutate({ issueId: item.issue.identifier });
              if (item.agentStuck && agent) actions.recover.mutate({ agentId: agent.id });
            }}
            className="h-7 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
          >
            Get it unstuck
          </button>
        )}
        <button
          onClick={() => onOpen(item.issue.identifier)}
          className="ml-auto h-7 flex-none rounded-md border border-input px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Open
        </button>
      </div>
    </div>
  );
}

export function NeedsYouStrip({ onOpenIssue }: { onOpenIssue: (id: string) => void }) {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const reviewByIssueId = useDashboardStore((s) => s.reviewStatusByIssueId);
  const pendingSubjects = usePendingInputSubjects();

  const { items, questions } = useMemo(() => {
    const issues = (issuesRaw as Issue[]) ?? [];
    const allAgents = Object.values(agentsById ?? {}) as AgentSnapshot[];
    const agentsByIssue = new Map<string, AgentSnapshot[]>();
    for (const a of allAgents) {
      const key = a.issueId?.toLowerCase();
      if (!key) continue;
      const list = agentsByIssue.get(key) ?? [];
      list.push(a);
      agentsByIssue.set(key, list);
    }
    const derivations = issues.map((issue) =>
      deriveSimpleIssue(issue, agentsByIssue.get(issue.identifier.toLowerCase()) ?? [], reviewByIssueId?.[issue.identifier]),
    );
    const needs = bucketSimpleHome(derivations).needsYou;
    const questionByIssue = new Map<string, string>();
    for (const s of pendingSubjects ?? []) {
      const q = s.pendingAskUserQuestion?.questions?.[0]?.question;
      if (s.issueId && q) questionByIssue.set(s.issueId.toLowerCase(), q);
    }
    return { items: needs, questions: questionByIssue };
  }, [issuesRaw, agentsById, reviewByIssueId, pendingSubjects]);

  if (items.length === 0) return null;

  return (
    <div className="mb-3 flex items-stretch gap-2.5 overflow-x-auto border-b border-border bg-warning/5 px-4 py-3" data-component="needs-you-strip">
      <div className="flex flex-none flex-col justify-center pr-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Needs you</span>
        <span className="text-xl font-medium text-warning-foreground">{items.length}</span>
      </div>
      {items.slice(0, 6).map(({ derivation, kind }) => (
        <NeedsYouRow
          key={derivation.issue.identifier}
          item={derivation}
          kind={kind}
          question={questions.get(derivation.issue.identifier.toLowerCase())}
          onOpen={onOpenIssue}
        />
      ))}
      {items.length > 6 && (
        <div className="flex flex-none items-center px-2 text-xs text-muted-foreground">+{items.length - 6} more</div>
      )}
    </div>
  );
}
