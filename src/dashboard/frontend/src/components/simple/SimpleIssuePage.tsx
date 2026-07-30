/**
 * PAN-2908 · C-SIMPLE — one issue, simple mode.
 * PAN-3090 — narrative feed + rich question card.
 *
 * Composition: status card (one plain sentence + ONE primary action) — or the
 * rich question card when the agent is blocked on a single-select question —
 * the four-step progress track (amber "waiting on you" when blocked), the
 * narrative "What it's doing" feed (kickoff prompt collapsed to a system
 * line, prose clamped, tool calls as one-line actions) with a steering
 * composer, and an Advanced disclosure that opens the full operator drawer.
 * No destructive actions here.
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { deriveSimpleIssue } from '../../lib/simple/derive';
import { getHelpUrl } from '../../lib/simple/helpUrl';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import { useUiMode, syncSimpleIssueUrl } from '../../lib/simple/uiMode';
import { SimpleActivityFeed } from './SimpleActivityFeed';
import { isRichQuestion, SimpleQuestionCard } from './SimpleQuestionCard';
import { SimpleTerminalExcerpt } from './SimpleTerminalExcerpt';
import { ModeToggle, PrimaryButton, QuietButton, StatusCard, StepsTrack } from './parts';

const S = SIMPLE_STRINGS.issue;

export function SimpleIssuePage({ issueId }: { issueId: string }) {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const reviewByIssueId = useDashboardStore((s) => s.reviewStatusByIssueId);
  const openDrawer = useDashboardStore((s) => s.openIssue);
  const closeSimpleIssue = useUiMode((s) => s.closeSimpleIssue);
  const actions = useSimpleActions();
  const composerRef = useRef<HTMLInputElement>(null);
  const [composerText, setComposerText] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const derivation = useMemo(() => {
    const issues = (issuesRaw as Issue[]) ?? [];
    const issue = issues.find((i) => i.identifier === issueId) ?? issues.find((i) => i.identifier.toLowerCase() === issueId.toLowerCase());
    if (!issue) return null;
    const agents = (Object.values(agentsById ?? {}) as AgentSnapshot[]).filter(
      (a) => a.issueId?.toLowerCase() === issue.identifier.toLowerCase(),
    );
    return deriveSimpleIssue(issue, agents, reviewByIssueId?.[issue.identifier]);
  }, [issuesRaw, agentsById, reviewByIssueId, issueId]);

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
  // Only a real open decision turns the composer into an answer box. A plan
  // agent that merely ended its turn has nothing to answer, and its session is
  // gone — routing an "answer" there sends into the void.
  const questionAgent = d.display.needsYouReason === 'question' ? d.pendingInputAgent : undefined;
  // The feed's switcher owns this selection; the composer below always talks
  // to the agent you're looking at.
  const selectedAgent = d.agents.find((a) => a.id === selectedAgentId) ?? agent;
  // Rich path (PAN-3090 FR-2): the card quotes the question and hosts
  // answering. Anything more complex keeps the generic card + composer.
  const richQuestion = questionAgent != null && isRichQuestion(questionAgent);
  const helpUrl = getHelpUrl(d.issue);
  const busy = actions.tell.isPending || actions.answer.isPending || actions.recover.isPending || actions.unstick.isPending || actions.merge.isPending || actions.startWork.isPending;

  const sendComposer = () => {
    const text = composerText.trim();
    if (!text) return;
    if (questionAgent) {
      actions.answer.mutate({ agentId: questionAgent.id, text });
    } else if (selectedAgent) {
      actions.tell.mutate({ agentId: selectedAgent.id, message: text });
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
        // PAN-3073: target the door(s) that actually tripped stuck — the
        // persistent review-status flag needs unstick; agent recovery alone
        // cannot clear it and silently no-ops on a healthy agent.
        return (
          <PrimaryButton
            disabled={busy || (!d.reviewStuck && !agent)}
            onClick={() => {
              if (d.reviewStuck) actions.unstick.mutate({ issueId: d.issue.identifier });
              if (d.agentStuck && agent) actions.recover.mutate({ agentId: agent.id });
            }}
          >
            {label}
          </PrimaryButton>
        );
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
    <div data-component="simple-issue-page" className="h-full w-full overflow-y-auto">
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

        <StepsTrack state={d.display.state} pipelineState={d.pipelineState} />

        {richQuestion ? (
          <SimpleQuestionCard
            agent={questionAgent}
            sending={actions.answer.isPending}
            onSend={(text, onSuccess) => actions.answer.mutate({ agentId: questionAgent.id, text }, { onSuccess })}
          />
        ) : (
          <StatusCard display={d.display}>
            {/* A question the rich card can't quote (pane-detected, or a payload
                shape it declines) still sits on the agent's screen — show that
                screen so the decision is visible next to the answer box. */}
            {questionAgent && <SimpleTerminalExcerpt agentId={questionAgent.id} />}
            {d.expectation && <span className="w-full text-xs text-muted-foreground">{d.expectation}</span>}
            {primary()}
            {d.display.secondaryActions.map((label) =>
              label === 'See what changed' && d.prUrl ? (
                <QuietButton key={label} onClick={() => window.open(d.prUrl!, '_blank', 'noopener')}>{label}</QuietButton>
              ) : label === 'Tell the agent something' ? (
                <QuietButton key={label} onClick={() => composerRef.current?.focus()}>{label}</QuietButton>
              ) : null,
            )}
          </StatusCard>
        )}

        {/* The narrative feed — what it's doing */}
        <section className="mt-6">
          <div className="mt-2.5">
            {agent ? (
              <SimpleActivityFeed
                issue={d.issue}
                agents={d.agents}
                agent={selectedAgent!}
                onSelectAgent={setSelectedAgentId}
                state={d.display.state}
                needsYouReason={d.display.needsYouReason}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nothing to show yet — updates appear here as it works.
              </div>
            )}
          </div>
          {!richQuestion && (
            <>
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
                  disabled={!composerText.trim() || (!selectedAgent && !questionAgent) || busy}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                  aria-label="Send"
                >
                  ➤
                </button>
              </div>
              <div className="mt-1.5 pl-1 text-[11px] text-muted-foreground">{questionAgent ? S.answerHint : S.composerHint}</div>
            </>
          )}
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
          Something look wrong?{' '}
          {helpUrl ? (
            <a href={helpUrl} target="_blank" rel="noreferrer" className="text-info-foreground underline underline-offset-2">
              {S.getHelp}
            </a>
          ) : (
            <span className="text-info-foreground">{S.getHelp}</span>
          )}{' '}
          — a human sees these.
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
