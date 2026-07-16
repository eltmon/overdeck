import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useIssueActions } from '../IssueActionMenu/useIssueActions';
import { ModelHarnessPicker, useAvailableModels, type Harness } from '../shared/ModelPicker';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { useIssueView } from './useIssueView';
import type { IssueViewDensity } from './inventory';

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return body.error ?? body.message ?? fallback;
}

export function StartAgentCta({ issueId, density }: { issueId: string; density: IssueViewDensity }) {
  const queryClient = useQueryClient();
  const actions = useIssueActions(issueId);
  const modelView = useIssueView(issueId);
  const { groups, defaultModel, harnessPolicy } = useAvailableModels();
  const [confirming, setConfirming] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [model, setModel] = useState(defaultModel);
  const [harness, setHarness] = useState<Harness>('claude-code');
  useEffect(() => { if (defaultModel) setModel(defaultModel); }, [defaultModel]);
  const start = actions.all.find((view) => view.action.key === 'startAgent');
  const resume = actions.all.find((view) => view.action.key === 'resumeSession');
  const gate = modelView.operator.needsYou?.kind === 'troubled' || actions.agent?.troubled ? 'troubled' : modelView.operator.needsYou?.kind === 'paused' || actions.agent?.paused ? 'paused' : null;
  const clearAndStart = Boolean(gate && start?.enabled);
  const mode = clearAndStart || start?.enabled ? 'start' : resume?.enabled ? 'resume' : null;
  const mutation = useMutation({
    mutationFn: async (mode: 'start' | 'resume') => {
      const agentId = actions.agent?.id ?? modelView.operator.needsYou?.sessionId;
      const url = mode === 'resume' ? `/api/agents/${agentId}/resume` : '/api/agents';
      const payload: Record<string, unknown> = mode === 'resume' ? {} : { issueId, projectId: actions.issue?.project?.id };
      if (mode === 'start' && clearAndStart) payload.clearGates = true;
      if (mode === 'start' && overrideEnabled) { payload.model = model; payload.harness = harness; }
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers: await dashboardMutationJsonHeaders(), body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await errorMessage(response, mode === 'resume' ? 'Failed to resume session' : 'Failed to start work agent'));
    },
    onSuccess: () => refreshDashboardState(queryClient),
  });
  if (!mode) return null;
  const compact = density === 'rail';
  const confirmCopy = gate === 'troubled' ? 'This agent was marked troubled after repeated failed resumes. Clear the troubled flag and start a fresh work agent?' : 'This agent is paused and needs your attention. Clear the paused gate and start a fresh work agent?';
  return <div data-section="StartAgentCta" className={compact ? 'inline-flex items-center gap-2' : 'w-full space-y-2'}>
    {confirming && <div role="dialog" className="rounded-[var(--radius-sm)] border border-warning/50 bg-warning/10 p-3 text-[12px]"><p>{confirmCopy}</p><div className="mt-2 flex gap-2"><button type="button" className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={() => mutation.mutate('start')}>Clear gate and start</button><button type="button" className="rounded border border-border px-2 py-1" onClick={() => setConfirming(false)}>Cancel</button></div></div>}
    {!confirming && <button type="button" disabled={mutation.isPending} className="rounded-[var(--radius-sm)] bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50" onClick={() => clearAndStart ? setConfirming(true) : mutation.mutate(mode)}>{mode === 'resume' ? 'Resume session' : 'Start work agent'}</button>}
    {!compact && mode === 'start' && <><button type="button" className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px]" aria-expanded={overrideOpen} onClick={() => setOverrideOpen((open) => !open)}><Settings2 className="h-3 w-3" />Overrides<ChevronDown className="h-3 w-3" /></button>{overrideOpen && <div className="rounded border border-border p-2"><label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={overrideEnabled} onChange={(event) => setOverrideEnabled(event.target.checked)} />Override default harness and model</label>{overrideEnabled && <ModelHarnessPicker model={model} harness={harness} onModelChange={setModel} onHarnessChange={setHarness} groups={groups} harnessPolicy={harnessPolicy} modelLabel="Agent model" />}</div>}</>}
    {mutation.error && <p role="alert" className="text-[12px] text-destructive">{mutation.error.message}</p>}
  </div>;
}
