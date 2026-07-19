/**
 * PAN-2908 · C-SIMPLE — one issue, simple mode.
 *
 * Status card (one plain sentence + ONE primary action), four-word progress
 * track, the live "what it's saying and doing" feed (memory observations) with
 * a steering composer, and an Advanced disclosure that opens the full operator
 * drawer for the same issue. No destructive actions here.
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useDashboardStore, selectMemoryObservations } from '../../lib/store';
import type { Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { deriveSimpleIssue } from '../../lib/simple/derive';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import { useUiMode, syncSimpleIssueUrl } from '../../lib/simple/uiMode';
import { ModeToggle, PrimaryButton, QuietButton, StatusCard, StepsTrack } from './parts';

const S = SIMPLE_STRINGS.issue;

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SimpleIssuePage({ issueId }: { issueId: string }) {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const reviewByIssueId = useDashboardStore((s) => s.reviewStatusByIssueId);
  const observations = useDashboardStore(selectMemoryObservations(issueId));
  const openDrawer = useDashboardStore((s) => s.openIssue);
  const closeSimpleIssue = useUiMode((s) => s.closeSimpleIssue);
  const actions = useSimpleActions();
  const composerRef = useRef<HTMLInputElement>(null);
  const [composerText, setComposerText] = useState('');

  const derivation = useMemo(() => {
    const issues = (issuesRaw as Issue[]) ?? [];
    const issue = issues.find((i) => i.identifier === issueId) ?? issues.find((i) => i.identifier.toLowerCase() === issueId.toLowerCase());
    if (!issue) return null;
    const agents = (Object.values(agentsById ?? {}) as AgentSnapshot[]).filter(
      (a) => a.issueId?.toLowerCase() === issue.identifier.toLowerCase(),
    );
    return deriveSimpleIssue(issue, agents, reviewByIssueId?.[issue.identifier]);
  }, [issuesRaw, agentsById, reviewByIssueId, issueId]);

  const feed = useMemo(
    () => [...(observations ?? [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8).reverse(),
    [observations],
  );

  if (!derivation) {
    return (
      <div className="h-full w-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-7">
          <BackLink />
          <p className="mt-8 text-sm text-muted-foreground">Can't find that task. It may have moved — head back and pick another.</p>
        </div>
      </div>
    );
  }

  const d = derivation;
  const agent = d.primaryAgent;
  const questionAgent = d.pendingInputAgent;
  const busy = actions.tell.isPending || actions.answer.isPending || actions.recover.isPending || actions.merge.isPending || actions.startWork.isPending;

  const sendComposer = () => {
    const text = composerText.trim();
    if (!text) return;
    if (questionAgent) {
      actions.answer.mutate({ agentId: questionAgent.id, text });
    } else if (agent) {
      actions.tell.mutate({ agentId: agent.id, message: text });
    }
    setComposerText('');
  };

  const primary = () => {
    const label = d.display.primaryAction;
    if (!label) return null;
    switch (label) {
      case 'Merge to main':
        return <PrimaryButton tone="success" disabled={busy} onClick={() => actions.merge.mutate({ issueId: d.issue.identifier })}>{label}</PrimaryButton>;
      case 'Start work':
        return <PrimaryButton disabled={busy} onClick={() => actions.startWork.mutate({ issueId: d.issue.identifier })}>{label}</PrimaryButton>;
      case 'Get it unstuck':
        return <PrimaryButton disabled={!agent || busy} onClick={() => agent && actions.recover.mutate({ agentId: agent.id })}>{label}</PrimaryButton>;
      case 'Tell the agent to fix them':
        return (
          <PrimaryButton disabled={!agent || busy} onClick={() => agent && actions.tell.mutate({ agentId: agent.id, message: 'Please address the review findings and get this back to green.' })}>
            {label}
          </PrimaryButton>
        );
      case 'See what changed':
        return d.prUrl ? <PrimaryButton onClick={() => window.open(d.prUrl!, '_blank', 'noopener')}>{label}</PrimaryButton> : null;
      case 'Answer':
        return <PrimaryButton disabled={busy} onClick={() => composerRef.current?.focus()}>{label}</PrimaryButton>;
      default:
        return null;
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-6">
        <div className="flex items-center justify-between">
          <BackLink />
          <ModeToggle />
        </div>

        <div className="mt-3.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{d.issue.identifier}</span>
            {d.issue.project?.name && <><span>·</span><span>{d.issue.project.name}</span></>}
          </div>
          <h1 className="mt-1 text-[21px] font-medium leading-snug">{d.issue.title}</h1>
        </div>

        <StepsTrack state={d.display.state} />

        <StatusCard display={d.display}>
          {primary()}
          {d.display.secondaryActions.map((label) =>
            label === 'See what changed' && d.prUrl ? (
              <QuietButton key={label} onClick={() => window.open(d.prUrl!, '_blank', 'noopener')}>{label}</QuietButton>
            ) : label === 'Tell the agent something' ? (
              <QuietButton key={label} onClick={() => composerRef.current?.focus()}>{label}</QuietButton>
            ) : null,
          )}
        </StatusCard>

        {/* The conversation — what it's saying and doing */}
        <section className="mt-6">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-sm font-medium">{S.conversationTitle}</h2>
            {agent && (agent.status === 'running' || agent.status === 'starting') && (
              <span className="flex items-center gap-1.5 text-[11px] text-info-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" /> live
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {feed.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nothing to show yet — updates appear here as it works.
              </div>
            )}
            {feed.map((obs) => (
              <div key={obs.id} className="max-w-[92%] self-start">
                <div className="mb-0.5 text-[10.5px] text-muted-foreground">the agent · {formatWhen(obs.timestamp)}</div>
                <div className="rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm">
                  {obs.narrative || obs.summary}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-input bg-card py-2 pl-3.5 pr-2 focus-within:border-ring">
            <input
              ref={composerRef}
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendComposer(); }}
              placeholder={questionAgent ? S.answerPlaceholder : S.composerPlaceholder}
              className="flex-1 bg-transparent text-[13.5px] text-foreground outline-none"
            />
            <button
              onClick={sendComposer}
              disabled={!composerText.trim() || (!agent && !questionAgent) || busy}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              aria-label="Send"
            >
              ➤
            </button>
          </div>
          <div className="mt-1.5 pl-1 text-[11px] text-muted-foreground">{questionAgent ? S.answerHint : S.composerHint}</div>
        </section>

        {/* Advanced disclosure */}
        <div className="mt-8 rounded-xl border border-border bg-card">
          <button
            onClick={() => openDrawer(d.issue.identifier, 'overview')}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] text-muted-foreground hover:text-foreground"
          >
            <span>▸</span> {S.advancedDisclosure}
          </button>
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Something look wrong? <span className="text-info-foreground">{S.getHelp}</span> — a human sees these.
        </div>
      </div>
    </div>
  );

  function BackLink() {
    return (
      <button
        onClick={() => { closeSimpleIssue(); syncSimpleIssueUrl(null); }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} /> {SIMPLE_STRINGS.issue.backToMyWork.replace('← ', '')}
      </button>
    );
  }
}
