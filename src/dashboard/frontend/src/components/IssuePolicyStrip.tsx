/** Shared per-issue review and staffing policy strip, collapsed to an overrides-only Policies control (PAN-2681). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { HelpTooltip, TooltipBody, TooltipProvider } from './shared/Tooltip';

/** Wide enough for a 108px label column plus a four-option segmented control and its reset link. */
const PANEL_WIDTH = 440;

type ReviewModeValue = 'quick' | 'full' | 'none';
type ReReviewScopeValue = 'all' | 'changed' | 'blockers';
type SwarmMode = 'off' | 'auto' | 'always';

interface ReviewConfigResponse {
  override: { reviewMode: ReviewModeValue | null; reReviewScope: ReReviewScopeValue | null; reviewModel: string | null };
  resolved: { reviewMode: ReviewModeValue; reReviewScope: ReReviewScopeValue; reviewModel: string | null };
}

interface StaffingResponse {
  override: { workModel: string | null };
  tieredExecution: {
    effective: boolean;
    source: 'issue-override' | 'plan-metadata' | 'global';
    override: 'on' | 'off' | null;
  };
  resolved: { model: string; tiered: boolean; source: 'issue' | 'default'; recordedModel: string | null };
}

interface SwarmResponse {
  configured: { mode?: SwarmMode } | null;
  resolved: { mode: SwarmMode; source: { mode: string } };
}

interface AvailableModel { id: string; name: string }
type AvailableModelsResponse = Record<string, AvailableModel[]>;

const selectClass =
  'w-full rounded border border-border bg-popover px-2 py-0.5 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

/**
 * Help copy for each dial, written against the resolvers rather than the docs — the two disagree.
 * Swarm `always` is deliberately not described as forcing a swarm: `resolveAutomaticSwarmPolicy`
 * only tests `mode !== 'off'`, so it is indistinguishable from `auto` until PAN-2646 lands.
 */
const POLICY_HELP = {
  reviewMode: {
    hint: 'How much AI review runs before merge.',
    title: 'Review mode',
    body: 'How much AI review runs once the work agent finishes. Typecheck, lint, and tests always run first — this dial never skips them.',
    options: [
      ['Quick', 'One reviewer makes a single self-review pass.'],
      ['Full', 'Four reviewers — security, correctness, performance, requirements — run in parallel, then a fifth synthesizes their reports.'],
      ['None', 'Skips AI review only. The issue still advances to test and merge.'],
    ] as Array<[string, string]>,
  },
  reReviewScope: {
    hint: 'Which reviewers run again after you push fixes.',
    title: 'Re-review scope',
    body: 'On the second and later review cycles, which of the four reviewers run again. Reviewers that are skipped carry their earlier verdict forward.',
    options: [
      ['Changed', 'Reviewers that blocked, plus any whose domain the new commits touch. Correctness and requirements re-run on any change; security and performance only on paths that match theirs.'],
      ['All', 'All four reviewers re-run every cycle.'],
      ['Blockers', 'Only reviewers that blocked last cycle.'],
    ] as Array<[string, string]>,
  },
  reviewModel: {
    hint: 'Which model reviews this issue.',
    title: 'Review model',
    body: 'Overrides the model used to review this issue. Leave on Default to use the model configured for the review role.',
  },
  workModel: {
    hint: 'Pins the implementation model for this issue.',
    title: 'Work model',
    body: 'Pins the model every work agent on this issue uses. It takes effect on the next spawn and applies to every dispatch after that — a running agent keeps the model it started with.',
  },
  swarm: {
    hint: 'Run plan items in parallel across several agents.',
    title: 'Swarm',
    body: 'Whether several work agents take independent plan items on this issue at the same time.',
    options: [
      ['Off', 'One work agent at a time.'],
      ['Auto', 'Swarms when the vBRIEF is partitionable and at least two items are independently startable.'],
      ['Always', 'Behaves the same as Auto today — it does not yet force a swarm on a plan that cannot partition.'],
    ] as Array<[string, string]>,
  },
  standingCrew: {
    hint: 'Route each item to a model tier by difficulty.',
    title: 'Standing crew',
    body: 'Routes each plan item to a model tier by its declared difficulty or kind, instead of running everything on one model. Items the tier table cannot place fall back to the work role’s model. Default shows both the value and where it came from — this issue, the plan’s vBRIEF metadata, or your global config.',
    options: [
      ['On', 'Use the tier table to pick a model per item.'],
      ['Off', 'Every item runs on the work role’s model.'],
    ] as Array<[string, string]>,
  },
};

interface SegmentedProps {
  ariaLabel: string;
  value: string | null;
  resolvedLabel: string;
  options: Array<[string, string]>;
  disabled: boolean;
  onChange: (next: string | null) => void;
}

function Segmented({ ariaLabel, value, resolvedLabel, options, disabled, onChange }: SegmentedProps) {
  const segmentClass = 'border-l border-border px-2 py-0.5 text-[11px] font-medium first:border-l-0 disabled:opacity-50';
  return (
    <div className="inline-flex overflow-hidden rounded border border-border" role="group" aria-label={ariaLabel}>
      <button type="button" aria-pressed={value === null} className={`${segmentClass} ${value === null ? 'bg-primary/12 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} disabled={disabled} onClick={() => onChange(null)}>
        Default <span className="text-[10px] text-muted-foreground">· {resolvedLabel}</span>
      </button>
      {options.map(([optionValue, label]) => (
        <button key={optionValue} type="button" aria-pressed={value === optionValue} className={`${segmentClass} ${value === optionValue ? 'bg-primary/12 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} disabled={disabled} onClick={() => onChange(optionValue)}>
          {label}
        </button>
      ))}
    </div>
  );
}

interface PolicyRowProps {
  label: string;
  help: { hint: string; title: string; body: string; options?: Array<[string, string]> };
  /** Drives the override dot and the label emphasis. */
  overridden: boolean;
  reset?: React.ReactNode;
  /** Conditional copy below the hint, e.g. the crew-suspension note. */
  note?: React.ReactNode;
  children: React.ReactNode;
}

function PolicyRow({ label, help, overridden, reset, note, children }: PolicyRowProps) {
  return (
    <div className="my-2 grid grid-cols-[108px_1fr] items-start gap-2.5">
      <span className={`flex items-center gap-1.5 pt-1 text-[12px] font-medium ${overridden ? 'text-foreground' : 'text-muted-foreground'}`}>
        <span className={`h-[5px] w-[5px] shrink-0 rounded-full bg-primary ${overridden ? 'opacity-100' : 'opacity-0'}`} />
        {label}
        <HelpTooltip
          label={label}
          side="left"
          content={<TooltipBody title={help.title} body={help.body} options={help.options} />}
        />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {children}
          {reset}
        </div>
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{help.hint}</div>
        {note}
      </div>
    </div>
  );
}

export function IssuePolicyStrip({ issueId }: { issueId: string }) {
  const [review, setReview] = useState<ReviewConfigResponse | null>(null);
  const [staffing, setStaffing] = useState<StaffingResponse | null>(null);
  const [swarm, setSwarm] = useState<SwarmResponse | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModelsResponse>({});
  const [saving, setSaving] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    const encoded = encodeURIComponent(issueId);
    const [reviewRes, staffingRes, swarmRes, modelsRes] = await Promise.all([
      fetch(`/api/review/${encoded}/config`),
      fetch(`/api/issues/${encoded}/staffing`),
      fetch(`/api/issues/${encoded}/swarm-policy`),
      fetch('/api/settings/available-models'),
    ]);
    if (reviewRes.ok) {
      const value = await reviewRes.json() as Partial<ReviewConfigResponse>;
      if (value.override && value.resolved) setReview(value as ReviewConfigResponse);
    }
    if (staffingRes.ok) {
      const value = await staffingRes.json() as Partial<StaffingResponse>;
      if (value.override && value.resolved) setStaffing(value as StaffingResponse);
    }
    if (swarmRes.ok) {
      const value = await swarmRes.json() as Partial<SwarmResponse>;
      if (value.resolved) setSwarm(value as SwarmResponse);
    }
    if (modelsRes.ok) setAvailableModels(await modelsRes.json() as AvailableModelsResponse);
  }, [issueId]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => { if (!cancelled) setReview(null); });
    return () => { cancelled = true; };
  }, [refresh]);

  const models = useMemo(() => Object.values(availableModels).flat()
    .filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name)), [availableModels]);

  const save = useCallback(async (url: string, body: unknown, method = 'POST') => {
    setSaving(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const positionPanel = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelWidth = Math.min(PANEL_WIDTH, Math.max(0, window.innerWidth - 16));
    setPanelPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8)),
    });
  }, []);

  const togglePanel = useCallback((opener: HTMLElement) => {
    if (open) {
      setOpen(false);
      return;
    }
    openerRef.current = opener;
    positionPanel();
    setOpen(true);
  }, [open, positionPanel]);

  const showPanel = useCallback((opener: HTMLElement) => {
    openerRef.current = opener;
    positionPanel();
    setOpen(true);
  }, [positionPanel]);

  useEffect(() => {
    if (!open) return;
    // Help triggers are skipped so focus still lands on the first real control, not an info affordance.
    panelRef.current?.querySelector<HTMLElement>('button:not([data-help-trigger]), select')?.focus();
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      openerRef.current?.focus();
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  if (!review || !staffing || !swarm) return null;
  const encoded = encodeURIComponent(issueId);
  // TODO(PAN-2683 FR-3): rename to `crews` once PAN-2684 lands — label copy belongs to whichever lands second.
  const workDefault = staffing.resolved.tiered ? 'tiered' : staffing.resolved.model;
  const needsRestart = Boolean(
    staffing.override.workModel && staffing.override.workModel !== staffing.resolved.recordedModel,
  );
  const crewSuspended = staffing.tieredExecution.effective && Boolean(staffing.override.workModel);
  const effectiveReviewMode = review.override.reviewMode ?? review.resolved.reviewMode;

  const modelName = (modelId: string) => models.find((model) => model.id === modelId)?.name ?? modelId;
  const overrides = [
    review.override.reviewMode && { key: 'review', label: 'review', value: review.override.reviewMode },
    review.override.reReviewScope && { key: 're-review', label: 're-review', value: review.override.reReviewScope },
    review.override.reviewModel && { key: 'review-model', label: 'review model', value: modelName(review.override.reviewModel) },
    staffing.override.workModel && {
      key: 'work',
      label: 'work',
      value: `${modelName(staffing.override.workModel)}${crewSuspended ? ' · replaces crews' : ''}`,
    },
    swarm.configured?.mode && { key: 'swarm', label: 'swarm', value: swarm.configured.mode },
    staffing.tieredExecution.override && { key: 'crew', label: 'crew', value: staffing.tieredExecution.override },
  ].filter((override): override is { key: string; label: string; value: string } => Boolean(override));
  const overrideCount = overrides.length;

  const restart = async () => {
    setSaving(true);
    setRestartMessage(null);
    try {
      const response = await fetch(`/api/agents/agent-${issueId.toLowerCase()}/restart-fresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spawn: true, model: staffing.override.workModel }),
      });
      const result = await response.json() as { error?: string; details?: string };
      setRestartMessage(response.ok ? 'Fresh restart requested.' : (result.error ?? 'Restart failed.'));
      if (response.ok) await refresh();
    } catch {
      setRestartMessage('Restart failed.');
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (review.override.reviewMode !== null) await save(`/api/review/${encoded}/config`, { reviewMode: null });
    if (review.override.reReviewScope !== null) await save(`/api/review/${encoded}/config`, { reReviewScope: null });
    if (review.override.reviewModel !== null) await save(`/api/review/${encoded}/config`, { reviewModel: null });
    if (staffing.override.workModel !== null) await save(`/api/issues/${encoded}/staffing`, { workModel: null });
    if (swarm.configured?.mode) await save(`/api/issues/${encoded}/swarm-policy`, { value: null });
    if (staffing.tieredExecution.override !== null) await save(`/api/workspaces/${encoded}/tiered-execution`, { override: null }, 'PATCH');
  };

  const resetClass = 'text-[10.5px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50';

  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="issue-policy-strip" title="Per-issue review and staffing overrides">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Issue policies"
        aria-expanded={open}
        className={`inline-flex h-[22px] items-center gap-1.5 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted hover:text-foreground ${overrideCount > 0 ? 'text-foreground' : 'text-muted-foreground'}`}
        onClick={(event) => togglePanel(event.currentTarget)}
      >
        <svg aria-hidden="true" className="h-[11px] w-[11px]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="2" y1="4.5" x2="14" y2="4.5" /><circle cx="6" cy="4.5" r="1.7" fill="currentColor" />
          <line x1="2" y1="11.5" x2="14" y2="11.5" /><circle cx="10.5" cy="11.5" r="1.7" fill="currentColor" />
        </svg>
        Policies
        {overrideCount > 0 && <span className="inline-flex min-w-[14px] items-center justify-center rounded-sm bg-primary/12 px-1 text-[9px] text-primary">{overrideCount}</span>}
      </button>

      {overrides.map((override) => (
        <button key={override.key} type="button" className="inline-flex h-5 items-center gap-1 rounded border border-primary/32 bg-primary/8 px-1.5 text-[11px] font-medium text-foreground" onClick={(event) => showPanel(event.currentTarget)}>
          <span className="text-muted-foreground">{override.label} ·</span> {override.value}
        </button>
      ))}

      {needsRestart && (
        <button type="button" className="inline-flex h-5 items-center rounded border border-warning/32 bg-warning/8 px-1.5 text-[11px] font-medium text-warning-foreground" onClick={(event) => showPanel(event.currentTarget)}>
          restart pending
        </button>
      )}

      {open && panelPos && createPortal(
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Issue policy overrides"
          tabIndex={-1}
          className="fixed z-[100] w-[440px] max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover px-4 pb-3 pt-3.5 shadow-lg"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Review</h3>
          <PolicyRow
            label="Mode"
            help={POLICY_HELP.reviewMode}
            overridden={Boolean(review.override.reviewMode)}
            reset={review.override.reviewMode ? <button type="button" aria-label="Reset review mode to default" className={resetClass} disabled={saving} onClick={() => save(`/api/review/${encoded}/config`, { reviewMode: null })}>reset</button> : undefined}
          >
            <Segmented ariaLabel="Review mode for this issue" value={review.override.reviewMode} resolvedLabel={review.resolved.reviewMode} options={[["quick", "Quick"], ["full", "Full"], ["none", "None"]]} disabled={saving} onChange={(next) => save(`/api/review/${encoded}/config`, { reviewMode: next })} />
          </PolicyRow>

          {effectiveReviewMode === 'full' && (
            <PolicyRow
              label="Re-review"
              help={POLICY_HELP.reReviewScope}
              overridden={Boolean(review.override.reReviewScope)}
              reset={review.override.reReviewScope ? <button type="button" aria-label="Reset re-review scope to default" className={resetClass} disabled={saving} onClick={() => save(`/api/review/${encoded}/config`, { reReviewScope: null })}>reset</button> : undefined}
            >
              <Segmented ariaLabel="Re-review scope for this issue" value={review.override.reReviewScope} resolvedLabel={review.resolved.reReviewScope} options={[["changed", "Changed"], ["all", "All"], ["blockers", "Blockers"]]} disabled={saving} onChange={(next) => save(`/api/review/${encoded}/config`, { reReviewScope: next })} />
            </PolicyRow>
          )}

          <PolicyRow
            label="Model"
            help={POLICY_HELP.reviewModel}
            overridden={Boolean(review.override.reviewModel)}
            reset={review.override.reviewModel ? <button type="button" aria-label="Reset review model to default" className={resetClass} disabled={saving} onClick={() => save(`/api/review/${encoded}/config`, { reviewModel: null })}>reset</button> : undefined}
          >
            <select aria-label="Review model for this issue" className={selectClass} disabled={saving} value={review.override.reviewModel ?? ''} onChange={(event) => save(`/api/review/${encoded}/config`, { reviewModel: event.target.value || null })}>
              <option value="">Default · {review.resolved.reviewModel ? modelName(review.resolved.reviewModel) : 'per-role default'}</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </PolicyRow>

          <h3 className="mb-2 mt-4 border-t border-border pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Work</h3>
          <PolicyRow
            label="Model"
            help={POLICY_HELP.workModel}
            overridden={Boolean(staffing.override.workModel)}
            reset={staffing.override.workModel ? <button type="button" aria-label="Reset work model to default" className={resetClass} disabled={saving} onClick={() => save(`/api/issues/${encoded}/staffing`, { workModel: null })}>reset</button> : undefined}
            note={crewSuspended ? <div className="mt-1 text-[11px] leading-snug text-muted-foreground">Overrides crew routing — every item on this issue runs this model.</div> : undefined}
          >
            <select aria-label="Work model for this issue" className={selectClass} disabled={saving} value={staffing.override.workModel ?? ''} onChange={(event) => save(`/api/issues/${encoded}/staffing`, { workModel: event.target.value || null })}>
              <option value="">Default · {workDefault}</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </PolicyRow>

          <PolicyRow
            label="Swarm"
            help={POLICY_HELP.swarm}
            overridden={Boolean(swarm.configured?.mode)}
            reset={swarm.configured?.mode ? <button type="button" aria-label="Reset swarm mode to default" className={resetClass} disabled={saving} onClick={() => save(`/api/issues/${encoded}/swarm-policy`, { value: null })}>reset</button> : undefined}
          >
            <Segmented ariaLabel="Swarm mode for this issue" value={swarm.configured?.mode ?? null} resolvedLabel={swarm.resolved.mode} options={[["off", "Off"], ["auto", "Auto"], ["always", "Always"]]} disabled={saving} onChange={(next) => save(`/api/issues/${encoded}/swarm-policy`, { value: next ? { mode: next } : null })} />
          </PolicyRow>

          <PolicyRow
            label="Standing crew"
            help={POLICY_HELP.standingCrew}
            overridden={Boolean(staffing.tieredExecution.override)}
            reset={staffing.tieredExecution.override ? <button type="button" aria-label="Reset standing crew to default" className={resetClass} disabled={saving} onClick={() => save(`/api/workspaces/${encoded}/tiered-execution`, { override: null }, 'PATCH')}>reset</button> : undefined}
          >
            <Segmented
              ariaLabel="Standing crew routing for this issue"
              value={staffing.tieredExecution.override}
              resolvedLabel={`${staffing.tieredExecution.effective ? 'on' : 'off'} (${staffing.tieredExecution.source === 'issue-override' ? 'issue' : staffing.tieredExecution.source === 'plan-metadata' ? 'plan' : 'global'})`}
              options={[["on", "On"], ["off", "Off"]]}
              disabled={saving}
              onChange={(next) => save(`/api/workspaces/${encoded}/tiered-execution`, { override: next }, 'PATCH')}
            />
          </PolicyRow>

          {needsRestart && (
            <div className="mt-3 rounded-md border border-warning/32 bg-warning/8 px-2.5 py-2 text-[11.5px] font-medium text-warning-foreground">
              <div>The work-model override applies to the next spawn; running agents are never restarted automatically.</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button type="button" className="rounded border border-warning/45 px-2 py-0.5 text-[11px] font-medium hover:bg-warning/10 disabled:opacity-50" disabled={saving} onClick={restart}>Restart agent with new staffing</button>
                {restartMessage && <span>{restartMessage}</span>}
              </div>
            </div>
          )}

          <div className="mt-3.5 flex items-center justify-between border-t border-border pt-2.5">
            <span className="text-[10.5px] font-medium text-muted-foreground">Overrides apply to this issue only.</span>
            {overrideCount > 0 && <button type="button" className="text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50" disabled={saving} onClick={resetAll}>Reset all to defaults</button>}
          </div>
        </div>
        </TooltipProvider>,
        document.body,
      )}
    </span>
  );
}
