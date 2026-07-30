/**
 * PAN-2908 · C-SIMPLE — "My work" home (simple mode default).
 *
 * Sections in fixed order: Needs you → Working now → Ready to merge →
 * Finished, plus a plain-words hand-off composer. One primary action per
 * card; destructive actions do not exist here (Advanced only).
 * Data: dashboard store (issues, agents, review status, pending input).
 */
import { useMemo, useState } from 'react';
import { useDashboardStore, type PendingInputSubject } from '../../lib/store';
import { usePendingInputSubjects } from '../../lib/useDecisions';
import type { Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { bucketSimpleHome, deriveSimpleIssue, type SimpleIssueDerivation, type NeedsYouKind } from '../../lib/simple/derive';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import { useUiMode, syncSimpleIssueUrl } from '../../lib/simple/uiMode';
import { ModeToggle, PrimaryButton, ProgressBar, QuietButton } from './parts';
import { TalkItThrough } from './TalkItThrough';

const S = SIMPLE_STRINGS.home;

function openIssue(d: SimpleIssueDerivation, openSimpleIssue: (id: string) => void) {
  openSimpleIssue(d.issue.identifier);
  syncSimpleIssueUrl(d.issue.identifier);
}

/* ── Just filed: freshly created issues, one click from planning ─────── */
const JUST_FILED_WINDOW_MS = 24 * 60 * 60 * 1000;

function justFiled(derivations: SimpleIssueDerivation[], now = Date.now()): SimpleIssueDerivation[] {
  return derivations
    .filter((d) => {
      if (d.display.state !== 'not-started') return false;
      const t = Date.parse(d.issue.createdAt ?? '');
      return Number.isFinite(t) && now - t < JUST_FILED_WINDOW_MS;
    })
    .sort((a, b) => (b.issue.createdAt ?? '').localeCompare(a.issue.createdAt ?? ''))
    .slice(0, 5);
}

function JustFiledCard({ item, onOpen }: { item: SimpleIssueDerivation; onOpen: () => void }) {
  const actions = useSimpleActions();
  const age = formatAge(item.issue.createdAt);
  return (
    <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono text-[10px]">{item.issue.identifier}</span>
          {age && <span>filed {age}</span>}
        </div>
        <button onClick={onOpen} className="mt-0.5 block w-full truncate text-left text-sm font-medium hover:underline">{item.issue.title}</button>
      </div>
      <QuietButton onClick={onOpen}>Open</QuietButton>
      <PrimaryButton disabled={actions.startPlanning.isPending} onClick={() => actions.startPlanning.mutate({ issueId: item.issue.identifier })}>
        Start planning
      </PrimaryButton>
    </div>
  );
}

function formatAge(iso?: string): string {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

/* ── Needs-you cards ─────────────────────────────────────────────────── */
function QuestionCard({ item, subject, onOpen }: { item: SimpleIssueDerivation; subject?: PendingInputSubject; onOpen: () => void }) {
  const actions = useSimpleActions();
  const agentsById = useDashboardStore((s) => s.agentsById);
  const [text, setText] = useState('');
  const subjectAgentId = subject?.agentId;
  const isConversation = !!(subjectAgentId && !agentsById?.[subjectAgentId]);
  const agentId = subjectAgentId ?? item.pendingInputAgent?.id;
  const question = subject?.pendingAskUserQuestion?.questions?.[0]?.question ?? item.display.sentence;
  const busy = actions.answer.isPending;
  return (
    <div className="mt-3 rounded-2xl border border-warning/40 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Question · {item.issue.title ? '' : ''}{item.issue.identifier}</span>
      </div>
      <button onClick={onOpen} className="mt-1 text-left text-[15px] font-medium hover:underline">{item.issue.title}</button>
      <p className="mt-2 text-[13.5px] leading-relaxed">{question}</p>
      <div className="mt-2.5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && agentId) actions.answer.mutate({ agentId, text: text.trim(), isConversation }); }}
          placeholder={SIMPLE_STRINGS.issue.answerPlaceholder}
          className="h-9 flex-1 rounded-lg border border-input bg-muted px-3 text-[13px] text-foreground outline-none focus:border-ring"
        />
        <PrimaryButton disabled={!text.trim() || !agentId || busy} onClick={() => agentId && actions.answer.mutate({ agentId, text: text.trim(), isConversation })}>
          {item.display.primaryAction ?? 'Answer'}
        </PrimaryButton>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{SIMPLE_STRINGS.issue.answerHint}</div>
    </div>
  );
}

function ProblemsCard({ item, kind, onOpen }: { item: SimpleIssueDerivation; kind: NeedsYouKind; onOpen: () => void }) {
  const actions = useSimpleActions();
  const agent = item.primaryAgent;
  const busy = actions.tell.isPending || actions.recover.isPending || actions.unstick.isPending || actions.startWork.isPending;
  const isStuck = kind === 'stuck';
  const isStartWork = kind === 'start-work';
  return (
    <div className="mt-3 rounded-2xl border border-warning/40 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{isStuck ? 'Stuck' : isStartWork ? item.display.title : 'Problems found'} · {item.issue.identifier}</span>
      </div>
      <button onClick={onOpen} className="mt-1 text-left text-[15px] font-medium hover:underline">{item.issue.title}</button>
      <p className="mt-2 text-[13.5px] leading-relaxed">{item.display.sentence}</p>
      <div className="mt-3 flex items-center gap-2">
        {isStartWork ? (
          <PrimaryButton disabled={busy} onClick={() => actions.startWork.mutate({ issueId: item.issue.identifier })}>
            {item.display.primaryAction}
          </PrimaryButton>
        ) : isStuck ? (
          <PrimaryButton
            disabled={busy || (!item.reviewStuck && !agent)}
            onClick={() => {
              if (item.reviewStuck) actions.unstick.mutate({ issueId: item.issue.identifier });
              if (item.agentStuck && agent) actions.recover.mutate({ agentId: agent.id });
            }}
          >
            Get it unstuck
          </PrimaryButton>
        ) : (
          <PrimaryButton
            disabled={!agent || busy}
            onClick={() => agent && actions.tell.mutate({ agentId: agent.id, message: 'Please address the review findings and get this back to green.' })}
          >
            Tell the agent to fix them
          </PrimaryButton>
        )}
        <QuietButton onClick={onOpen}>Open</QuietButton>
      </div>
    </div>
  );
}

/* ── Working / Ready / Finished rows ─────────────────────────────────── */
function WorkingRow({ item, onOpen }: { item: SimpleIssueDerivation; onOpen: () => void }) {
  return (
    <div className="mt-2.5 flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
      <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-info" />
      <div className="min-w-0 flex-1">
        <button onClick={onOpen} className="block w-full truncate text-left text-sm font-medium hover:underline">{item.issue.title}</button>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <span className="text-info-foreground">{item.display.title}</span>
          {item.taskProgress ? ` · task ${item.taskProgress.completed} of ${item.taskProgress.total}` : ''}
          {item.expectation ? ` · ${item.expectation}` : ''}
        </div>
        {item.taskProgress && <ProgressBar completed={item.taskProgress.completed} total={item.taskProgress.total} />}
      </div>
      <QuietButton onClick={onOpen}>Watch</QuietButton>
    </div>
  );
}

function ReadyCard({ item, onOpen }: { item: SimpleIssueDerivation; onOpen: () => void }) {
  const actions = useSimpleActions();
  return (
    <div className="mt-3 rounded-2xl border border-success/40 bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">All checks passed · {item.issue.identifier}</div>
      <button onClick={onOpen} className="mt-1 text-left text-[15px] font-medium hover:underline">{item.issue.title}</button>
      <p className="mt-2 text-[13.5px] leading-relaxed">{item.display.sentence}</p>
      <div className="mt-3 flex items-center gap-2">
        <PrimaryButton tone="success" disabled={actions.merge.isPending} onClick={() => actions.merge.mutate({ issueId: item.issue.identifier })}>
          Merge to main
        </PrimaryButton>
        {item.prUrl && (
          <QuietButton onClick={() => window.open(item.prUrl!, '_blank', 'noopener')}>See the changes</QuietButton>
        )}
        <span className="ml-auto text-xs text-muted-foreground">Nothing merges by itself here</span>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */
export function SimpleHomePage() {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const reviewByIssueId = useDashboardStore((s) => s.reviewStatusByIssueId);
  const pendingSubjects = usePendingInputSubjects();
  const openSimpleIssue = useUiMode((s) => s.openSimpleIssue);

  const { derivations, buckets, byIdentifier } = useMemo(() => {
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
    return {
      derivations,
      buckets: bucketSimpleHome(derivations),
      byIdentifier: new Map(derivations.map((d) => [d.issue.identifier.toLowerCase(), d])),
    };
  }, [issuesRaw, agentsById, reviewByIssueId]);

  const subjectByIssue = useMemo(() => {
    const map = new Map<string, PendingInputSubject>();
    for (const s of pendingSubjects ?? []) {
      if (s.issueId) map.set(s.issueId.toLowerCase(), s);
    }
    return map;
  }, [pendingSubjects]);

  // Pending-input subjects whose issue didn't bucket as needs-you still show as questions.
  const extraQuestions = useMemo(() => {
    const covered = new Set(buckets.needsYou.map((n) => n.derivation.issue.identifier.toLowerCase()));
    const out: { derivation: SimpleIssueDerivation; subject: PendingInputSubject }[] = [];
    for (const [key, subject] of subjectByIssue) {
      if (covered.has(key)) continue;
      const d = byIdentifier.get(key);
      if (d) out.push({ derivation: d, subject });
    }
    return out;
  }, [buckets.needsYou, subjectByIssue, byIdentifier]);

  const needsCount = buckets.needsYou.length + extraQuestions.length;
  const filed = useMemo(() => justFiled(derivations), [derivations]);

  return (
    <div data-component="simple-home-page" className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium">{needsCount > 0 ? `${needsCount} thing${needsCount === 1 ? '' : 's'} need${needsCount === 1 ? 's' : ''} you.` : S.greetingFallback}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {needsCount > 0 ? 'Everything else is moving on its own.' : S.nothingNeedsYou}
            </p>
            <div className="mt-3 flex gap-4 text-[13px] text-muted-foreground">
              <span><b className="font-medium text-foreground">{buckets.working.length}</b> being worked on</span>
              <span><b className="font-medium text-foreground">{buckets.ready.length}</b> ready to merge</span>
              <span><b className="font-medium text-foreground">{buckets.finished.length}</b> finished this week</span>
            </div>
          </div>
          <ModeToggle />
        </div>

        <TalkItThrough />

        <section className="mt-8">
          <h2 className="text-[15px] font-medium">{S.needsYouTitle} <span className="text-xs text-muted-foreground">{needsCount}</span></h2>
          <div className="mt-0.5 text-xs text-muted-foreground">{S.needsYouSub}</div>
          {needsCount === 0 && <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{S.nothingNeedsYou}</div>}
          {buckets.needsYou.map(({ derivation, kind }) =>
            kind === 'question' ? (
              <QuestionCard key={derivation.issue.identifier} item={derivation} subject={subjectByIssue.get(derivation.issue.identifier.toLowerCase())} onOpen={() => openIssue(derivation, openSimpleIssue)} />
            ) : (
              <ProblemsCard key={derivation.issue.identifier} item={derivation} kind={kind} onOpen={() => openIssue(derivation, openSimpleIssue)} />
            ),
          )}
          {extraQuestions.map(({ derivation, subject }) => (
            <QuestionCard key={`q-${derivation.issue.identifier}`} item={derivation} subject={subject} onOpen={() => openIssue(derivation, openSimpleIssue)} />
          ))}
        </section>

        {filed.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[15px] font-medium">Just filed <span className="text-xs text-muted-foreground">{filed.length}</span></h2>
            <div className="mt-0.5 text-xs text-muted-foreground">Fresh from your conversations — start planning when you're ready.</div>
            {filed.map((d) => (
              <JustFiledCard key={d.issue.identifier} item={d} onOpen={() => openIssue(d, openSimpleIssue)} />
            ))}
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-[15px] font-medium">{S.workingTitle} <span className="text-xs text-muted-foreground">{buckets.working.length}</span></h2>
          <div className="mt-0.5 text-xs text-muted-foreground">{S.workingSub}</div>
          {buckets.working.map((d) => (
            <WorkingRow key={d.issue.identifier} item={d} onOpen={() => openIssue(d, openSimpleIssue)} />
          ))}
        </section>

        {buckets.ready.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[15px] font-medium">{S.readyTitle} <span className="text-xs text-muted-foreground">{buckets.ready.length}</span></h2>
            {buckets.ready.map((d) => (
              <ReadyCard key={d.issue.identifier} item={d} onOpen={() => openIssue(d, openSimpleIssue)} />
            ))}
          </section>
        )}

        {buckets.finished.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[15px] font-medium">{S.doneTitle} <span className="text-xs text-muted-foreground">{buckets.finished.length}</span></h2>
            <div className="mt-2">
              {buckets.finished.slice(0, 8).map((d) => (
                <button key={d.issue.identifier} onClick={() => openIssue(d, openSimpleIssue)} className="flex w-full items-center gap-2.5 border-b border-border py-2.5 text-left text-[13px] last:border-none hover:bg-accent/40">
                  <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-success/15 text-[10px] text-success-foreground">✓</span>
                  <span className="truncate">{d.issue.title}</span>
                  <span className="ml-auto flex-none text-[11.5px] text-muted-foreground">{d.issue.identifier}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
