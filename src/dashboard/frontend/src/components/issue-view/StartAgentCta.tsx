import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useIssueActions } from '../IssueActionMenu/useIssueActions';
import { recoveryFromBody, StartBlockHandoff, useResumeRecovery } from '../../lib/resumeRecovery';
import { ModelHarnessPicker, useAvailableModels, type Harness } from '../shared/ModelPicker';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { toastResumeOutcome } from '../../lib/resumeOutcome';
import type { IssueViewDensity } from './inventory';

type StartAgentCtaSurface = 'issue-view' | 'chip' | 'inline';

export function StartAgentCta({ issueId, density, surface = 'issue-view' }: { issueId: string; density: IssueViewDensity; surface?: StartAgentCtaSurface }) {
  const queryClient = useQueryClient();
  const actions = useIssueActions(issueId);
  const openRecovery = useResumeRecovery((s) => s.openRecovery);
  const { groups, defaultModel, harnessPolicy } = useAvailableModels();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [model, setModel] = useState(defaultModel);
  const [harness, setHarness] = useState<Harness>('claude-code');
  useEffect(() => { if (defaultModel) setModel(defaultModel); }, [defaultModel]);
  const start = actions.all.find((view) => view.action.key === 'startAgent');
  const resume = actions.all.find((view) => view.action.key === 'resumeSession');
  const gate = actions.agent?.troubled ? 'troubled' : actions.agent?.paused ? 'paused' : null;
  const clearAndStart = Boolean(gate && start?.enabled);
  const mode = clearAndStart ? 'start' : resume?.enabled ? 'resume' : start?.enabled ? 'start' : null;
  const mutation = useMutation({
    mutationFn: async (mode: 'start' | 'resume') => {
      const agentId = actions.agent?.id;
      const url = mode === 'resume' ? `/api/agents/${agentId}/resume` : '/api/agents';
      const payload: Record<string, unknown> = mode === 'resume' ? {} : { issueId, projectId: actions.issue?.project?.id };
      if (mode === 'start' && overrideEnabled) { payload.model = model; payload.harness = harness; }
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers: await dashboardMutationJsonHeaders(), body: JSON.stringify(payload) });
      if (!response.ok) {
        // A 409 start-block is a CHOICE, not an error — hand it to the
        // recovery dialog (Resume / Start fresh, Unpause & start, …) instead
        // of printing the server's CLI instructions inline.
        const text = await response.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        const recovery = response.status === 409 ? recoveryFromBody(parsed) : null;
        if (recovery) {
          openRecovery({ ...recovery, issueId });
          throw new StartBlockHandoff();
        }
        const body = parsed as { error?: string; message?: string } | null;
        throw new Error(body?.error ?? body?.message ?? (mode === 'resume' ? 'Failed to resume session' : 'Failed to start work agent'));
      }
    },
    onSuccess: (_data, mode) => {
      if (mode === 'resume' && actions.agent?.id) toastResumeOutcome(actions.agent.id);
      refreshDashboardState(queryClient);
    },
  });
  if (!mode) return null;
  const compact = density === 'rail' || surface !== 'issue-view';
  // PAN-2975: the resume affordance is quiet and self-identifying — the issue
  // id rides on the button so a tree full of them is never ambiguous, and the
  // copy says what resume actually does (reopens with memory intact).
  const resumeLabel = surface === 'chip' ? `▶ Resume · ${issueId}` : surface === 'inline' ? `Resume · ${issueId}` : `Resume session · ${issueId}`;
  // Style-guide card-footer rule: action links stay monochromatic; the ONE
  // allowed color exception is the primary CTA in text-primary — never a
  // filled bg-primary block on a dense row.
  const startLabel = surface === 'chip' ? `▶ Start · ${issueId}` : surface === 'inline' ? `Start · ${issueId}` : 'Start work agent';
  const label = mode === 'resume' ? resumeLabel : startLabel;
  // Pending keeps the issue id on compact surfaces (PAN-2975) so a tree full
  // of spinning buttons stays unambiguous; starting can take minutes when the
  // workspace docker stack has to come up, so the wait must be visible.
  const pendingLabel = compact
    ? `${mode === 'resume' ? 'Resuming' : 'Starting'}… · ${issueId}`
    : mode === 'resume' ? 'Resuming…' : 'Starting…';
  const compactButtonClass = mode === 'resume'
    ? 'inline-flex items-center gap-1 rounded-[4px] border border-info/30 bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info-foreground transition-colors hover:bg-info/20 disabled:opacity-50'
    : 'inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50';
  const fullButtonClass = mode === 'resume'
    ? 'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-info/40 bg-info/10 px-2.5 py-1.5 text-[12px] font-semibold text-info-foreground transition-colors hover:bg-info/20 disabled:opacity-50'
    : 'rounded-[var(--radius-sm)] bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50';
  const handleClick = () => {
    const agentId = actions.agent?.id;
    // A gated agent (paused / troubled) gets the recovery dialog — the same
    // Unpause & start / Clear gate & start surface every other entry point
    // uses — instead of a cramped inline confirm.
    if (gate && start?.enabled && agentId) {
      openRecovery({ kind: gate, agentId, issueId });
      return;
    }
    mutation.mutate(mode);
  };
  return <div data-section="StartAgentCta" className={compact ? 'inline-flex items-center gap-2' : 'w-full space-y-2'} onClick={(event) => event.stopPropagation()}>
    <button
      type="button"
      disabled={mutation.isPending}
      title={mode === 'resume' ? `Reopens the saved session for ${issueId} with its memory intact` : undefined}
      className={compact ? compactButtonClass : fullButtonClass}
      onClick={handleClick}
    >
      {mutation.isPending ? pendingLabel : label}
    </button>
    {!compact && mode === 'start' && <><button type="button" className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px]" aria-expanded={overrideOpen} onClick={() => setOverrideOpen((open) => !open)}><Settings2 className="h-3 w-3" />Overrides<ChevronDown className="h-3 w-3" /></button>{overrideOpen && <div className="rounded border border-border p-2"><label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={overrideEnabled} onChange={(event) => setOverrideEnabled(event.target.checked)} />Override default harness and model</label>{overrideEnabled && <ModelHarnessPicker model={model} harness={harness} onModelChange={setModel} onHarnessChange={setHarness} groups={groups} harnessPolicy={harnessPolicy} modelLabel="Agent model" />}</div>}</>}
    {mutation.error && !(mutation.error instanceof StartBlockHandoff) && (
      // Red error text must be copyable even inside a button row — selectable
      // + stopPropagation so selecting it doesn't fire the row.
      <p
        role="alert"
        className="text-[12px] text-destructive select-text cursor-text"
        onClick={(event) => event.stopPropagation()}
      >
        {mutation.error.message}
      </p>
    )}
  </div>;
}
