/**
 * PAN-2908 · C-BOARD — the "Needs you" strip.
 *
 * PAN-5413: the strip's count is the shared Needs-you selector
 * (useNeedsYouItems), so it matches the top bar. Simple reasons the selector
 * does not count — plans ready to start, stuck agents, review problems —
 * render as two labelled groups (Ready to start / Having trouble) in the
 * same strip, outside the count.
 */
import { useMemo, useState } from 'react';
import { useDashboardStore } from '../../lib/store';
import type { BackendPane, Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { bucketSimpleHome, deriveSimpleIssue, type SimpleIssueDerivation, type NeedsYouKind } from '../../lib/simple/derive';
import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import { useNeedsYouItems, type NeedsYouItem } from '../../lib/selectors/needsYou';
import { simpleNeedsYouCards, simpleSecondarySections, type SimpleNeedsYouCard } from '../../lib/simple/needsYouCards';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';

const KIND_META: Record<NeedsYouKind, { label: string; tone: string }> = {
  question: { label: 'Question', tone: 'border-warning/40' },
  'start-work': { label: 'Plan ready', tone: 'border-warning/40' },
  problems: { label: 'Problems found', tone: 'border-warning/40' },
  stuck: { label: 'Stuck', tone: 'border-destructive/40' },
};

export function NeedsYouRow({
  item,
  kind,
  question,
  onOpen,
  isConversation,
  conversationName,
}: {
  item: SimpleIssueDerivation;
  kind: NeedsYouKind;
  question?: string;
  onOpen: (id: string) => void;
  isConversation?: boolean;
  conversationName?: string;
}) {
  const actions = useSimpleActions();
  const [answer, setAnswer] = useState('');
  const agent = item.primaryAgent;
  const questionAgent = isConversation ? undefined : item.pendingInputAgent;
  const answerTarget = conversationName || questionAgent?.id;
  const busy = actions.tell.isPending || actions.recover.isPending || actions.answer.isPending || actions.startWork.isPending;
  const meta = KIND_META[kind];
  // PAN-4399: a gave-up post-planning auto-start is still "Start work" (same
  // button, same action) but the operator needs to see it never ran, not
  // that a plan is merely ready.
  const label = kind === 'start-work' && item.workStartError ? 'Work agent not started' : meta.label;

  return (
    <div className={`flex-none w-[340px] rounded-xl border bg-card p-3 shadow-sm ${meta.tone}`} data-needs-you={item.issue.identifier}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{item.issue.identifier}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <button onClick={() => onOpen(item.issue.identifier)} className="mt-1 block w-full truncate text-left text-xs font-medium hover:underline">
        {item.issue.title}
      </button>
      <div className="mt-1 text-[11.5px] text-muted-foreground line-clamp-2">
        {kind === 'question' && question
          ? question
          : kind === 'start-work' && item.workStartError
            ? item.workStartError
            : item.display.sentence}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {kind === 'question' && (
          <>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim() && answerTarget) actions.answer.mutate({ agentId: answerTarget, text: answer.trim(), isConversation }); }}
              placeholder="Type your answer…"
              className="h-7 flex-1 rounded-md border border-input bg-muted px-2 text-[11.5px] text-foreground outline-none focus:border-ring"
            />
            <button
              disabled={!answer.trim() || !answerTarget || busy}
              onClick={() => answerTarget && actions.answer.mutate({ agentId: answerTarget, text: answer.trim(), isConversation })}
              className="h-7 flex-none rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
            >
              Answer
            </button>
          </>
        )}
        {kind === 'start-work' && (
          <button
            disabled={busy}
            onClick={() => actions.startWork.mutate({ issueId: item.issue.identifier })}
            className="h-7 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
          >
            Start work
          </button>
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
            disabled={busy || !agent}
            onClick={() => agent && actions.recover.mutate({ agentId: agent.id })}
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

function StripCardView({ card, onOpenIssue }: { card: SimpleNeedsYouCard; onOpenIssue: (id: string) => void }) {
  if (card.card === 'item' || !card.derivation) {
    return <NeedsYouItemRow item={card.item} onOpen={() => card.item.open()} />;
  }
  const subject = card.item.subject;
  const isConversation = subject?.source === 'conversation';
  return (
    <NeedsYouRow
      // card.item.key stays `issue:<ID>` even when the first subject on that
      // issue changes (a question answered, a different agent asking next);
      // keying on the subject's agent remounts the row so a typed-but-unsent
      // draft never survives onto a different agent's question.
      key={subject?.agentId ?? card.item.key}
      item={card.derivation}
      kind={card.card}
      question={subject ? card.item.ask : undefined}
      onOpen={onOpenIssue}
      isConversation={isConversation}
      // The answer target is always the subject that asked, not whichever
      // agent `deriveSimpleIssue` happened to pick as `pendingInputAgent` —
      // two agents can be waiting on one issue at once (PAN-5413 review).
      conversationName={subject?.agentId}
    />
  );
}

function NeedsYouItemRow({ item, onOpen }: { item: NeedsYouItem; onOpen: () => void }) {
  return (
    <div className="flex-none w-[340px] rounded-xl border bg-card p-3 shadow-sm border-warning/40" data-needs-you-item={item.key}>
      <div className="text-xs font-medium">{item.title}</div>
      <div className="mt-1 text-[11.5px] text-muted-foreground line-clamp-2">{item.ask}</div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onOpen}
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
  const derivedByIssueId = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const panesById = useDashboardStore((s) => s.backendPanesById);

  const { byIdentifier, bucketNeeds } = useMemo(() => {
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
    // The backend's pane inventory is what makes an issue "running" rather
    // than "waiting on you" — bucket it per issue so each derivation sees its
    // own panes.
    const panesByIssue = new Map<string, BackendPane[]>();
    for (const pane of Object.values(panesById ?? {})) {
      const key = pane.issue?.toLowerCase();
      if (!key) continue;
      const list = panesByIssue.get(key) ?? [];
      list.push(pane);
      panesByIssue.set(key, list);
    }
    const panesOf = (issue: Issue) => panesByIssue.get(issue.identifier.toLowerCase()) ?? [];
    const derivations = issues.map((issue) =>
      deriveSimpleIssue(
        issue,
        agentsByIssue.get(issue.identifier.toLowerCase()) ?? [],
        derivedByIssueId?.[issue.identifier],
        panesOf(issue),
      ),
    );
    return {
      byIdentifier: new Map(derivations.map((d) => [d.issue.identifier.toLowerCase(), d])),
      bucketNeeds: bucketSimpleHome(derivations).needsYou,
    };
  }, [issuesRaw, agentsById, derivedByIssueId, panesById]);

  const needsItems = useNeedsYouItems();
  const cards = useMemo(() => simpleNeedsYouCards(needsItems, byIdentifier), [needsItems, byIdentifier]);
  const secondary = useMemo(() => simpleSecondarySections(bucketNeeds, needsItems), [bucketNeeds, needsItems]);
  const needsCount = needsItems.length;

  if (needsCount === 0 && secondary.readyToStart.length === 0 && secondary.trouble.length === 0) return null;

  return (
    <div className="mb-3 flex items-stretch gap-2.5 overflow-x-auto border-b border-border bg-warning/5 px-4 py-3" data-component="needs-you-strip">
      <div className="flex flex-none flex-col justify-center pr-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Needs you</span>
        <span className="text-xl font-medium text-warning-foreground" data-testid="needs-you-strip-count">{needsCount}</span>
      </div>
      {cards.slice(0, 6).map((c) => (
        <div key={c.item.key} data-testid="needs-you-strip-row" data-needs-you-key={c.item.key} className="flex flex-none">
          <StripCardView card={c} onOpenIssue={onOpenIssue} />
        </div>
      ))}
      {needsCount > 6 && (
        <div className="flex flex-none items-center px-2 text-xs text-muted-foreground">+{needsCount - 6} more</div>
      )}
      {secondary.readyToStart.length > 0 && (
        <div className="flex flex-none items-stretch gap-2.5 border-l border-border pl-2.5" data-testid="needs-you-strip-ready-to-start">
          <div className="flex flex-none flex-col justify-center pr-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{SIMPLE_STRINGS.home.readyToStartTitle}</span>
            <span className="text-xl font-medium text-muted-foreground">{secondary.readyToStart.length}</span>
          </div>
          {secondary.readyToStart.slice(0, 6).map((d) => (
            <NeedsYouRow key={d.issue.identifier} item={d} kind="start-work" onOpen={onOpenIssue} />
          ))}
          {secondary.readyToStart.length > 6 && (
            <div className="flex flex-none items-center px-2 text-xs text-muted-foreground">+{secondary.readyToStart.length - 6} more</div>
          )}
        </div>
      )}
      {secondary.trouble.length > 0 && (
        <div className="flex flex-none items-stretch gap-2.5 border-l border-border pl-2.5" data-testid="needs-you-strip-having-trouble">
          <div className="flex flex-none flex-col justify-center pr-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{SIMPLE_STRINGS.home.troubleTitle}</span>
            <span className="text-xl font-medium text-muted-foreground">{secondary.trouble.length}</span>
          </div>
          {secondary.trouble.slice(0, 6).map((t) => (
            <NeedsYouRow key={t.derivation.issue.identifier} item={t.derivation} kind={t.kind} onOpen={onOpenIssue} />
          ))}
          {secondary.trouble.length > 6 && (
            <div className="flex flex-none items-center px-2 text-xs text-muted-foreground">+{secondary.trouble.length - 6} more</div>
          )}
        </div>
      )}
    </div>
  );
}
