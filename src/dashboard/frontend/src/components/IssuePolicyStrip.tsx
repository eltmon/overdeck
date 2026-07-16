/** Shared per-issue review and staffing policy strip, collapsed to an overrides-only Policies control (PAN-2681). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
    const panelWidth = Math.min(400, Math.max(0, window.innerWidth - 16));
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
    panelRef.current?.querySelector<HTMLElement>('button, select')?.focus();
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

  const rowLabelClass = 'flex items-center gap-1.5 text-[12px] font-medium';
  const resetClass = 'text-[10.5px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50';
  const controlCellClass = 'flex min-w-0 items-center gap-2';

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
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Issue policy overrides"
          tabIndex={-1}
          className="fixed z-[100] w-[400px] max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover px-4 pb-3 pt-3.5 shadow-lg"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Review</h3>
          <div className="my-2 grid grid-cols-[92px_1fr] items-center gap-2.5">
            <span className={`${rowLabelClass} ${review.override.reviewMode ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`h-[5px] w-[5px] rounded-full bg-primary ${review.override.reviewMode ? 'opacity-100' : 'opacity-0'}`} /> Mode
            </span>
            <div className={controlCellClass}>
              <Segmented ariaLabel="Review mode for this issue" value={review.override.reviewMode} resolvedLabel={review.resolved.reviewMode} options={[["quick", "Quick"], ["full", "Full"], ["none", "None"]]} disabled={saving} onChange={(next) => save(`/api/review/${encoded}/config`, { reviewMode: next })} />
              {review.override.reviewMode && <button type="button" aria-label="Reset review mode to default" className={resetClass} disabled={saving} onClick={() => save(`/api/review/${encoded}/config`, { reviewMode: null })}>reset</button>}
            </div>
          </div>

          {effectiveReviewMode === 'full' && (
            <div className="my-2 grid grid-cols-[92px_1fr] items-center gap-2.5">
              <span className={`${rowLabelClass} ${review.override.reReviewScope ? 'text-foreground' : 'text-muted-foreground'}`}>
                <span className={`h-[5px] w-[5px] rounded-full bg-primary ${review.override.reReviewScope ? 'opacity-100' : 'opacity-0'}`} /> Re-review
              </span>
              <div className={controlCellClass}>
                <Segmented ariaLabel="Re-review scope for this issue" value={review.override.reReviewScope} resolvedLabel={review.resolved.reReviewScope} options={[["changed", "Changed"], ["all", "All"], ["blockers", "Blockers"]]} disabled={saving} onChange={(next) => save(`/api/review/${encoded}/config`, { reReviewScope: next })} />
                {review.override.reReviewScope && <button type="button" aria-label="Reset re-review scope to default" className={resetClass} disabled={saving} onClick={() => save(`/api/review/${encoded}/config`, { reReviewScope: null })}>reset</button>}
              </div>
            </div>
          )}

          <div className="my-2 grid grid-cols-[92px_1fr] items-center gap-2.5">
            <span className={`${rowLabelClass} ${review.override.reviewModel ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`h-[5px] w-[5px] rounded-full bg-primary ${review.override.reviewModel ? 'opacity-100' : 'opacity-0'}`} /> Model
            </span>
            <div className={controlCellClass}>
              <select aria-label="Review model for this issue" className={selectClass} disabled={saving} value={review.override.reviewModel ?? ''} onChange={(event) => save(`/api/review/${encoded}/config`, { reviewModel: event.target.value || null })}>
                <option value="">Default · {review.resolved.reviewModel ? modelName(review.resolved.reviewModel) : 'per-role default'}</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              {review.override.reviewModel && <button type="button" aria-label="Reset review model to default" className={resetClass} disabled={saving} onClick={() => save(`/api/review/${encoded}/config`, { reviewModel: null })}>reset</button>}
            </div>
          </div>

          <h3 className="mb-2 mt-4 border-t border-border pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Work</h3>
          <div className="my-2 grid grid-cols-[92px_1fr] items-center gap-2.5">
            <span className={`${rowLabelClass} ${staffing.override.workModel ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`h-[5px] w-[5px] rounded-full bg-primary ${staffing.override.workModel ? 'opacity-100' : 'opacity-0'}`} /> Model
            </span>
            <div className="min-w-0">
              <div className={controlCellClass}>
                <select aria-label="Work model for this issue" className={selectClass} disabled={saving} value={staffing.override.workModel ?? ''} onChange={(event) => save(`/api/issues/${encoded}/staffing`, { workModel: event.target.value || null })}>
                  <option value="">Default · {workDefault}</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                {staffing.override.workModel && <button type="button" aria-label="Reset work model to default" className={resetClass} disabled={saving} onClick={() => save(`/api/issues/${encoded}/staffing`, { workModel: null })}>reset</button>}
              </div>
              {crewSuspended && <div className="mt-1 text-[11px] text-muted-foreground">Overrides crew routing — every item on this issue runs this model.</div>}
            </div>
          </div>

          <div className="my-2 grid grid-cols-[92px_1fr] items-center gap-2.5">
            <span className={`${rowLabelClass} ${swarm.configured?.mode ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`h-[5px] w-[5px] rounded-full bg-primary ${swarm.configured?.mode ? 'opacity-100' : 'opacity-0'}`} /> Swarm
            </span>
            <div className={controlCellClass}>
              <Segmented ariaLabel="Swarm mode for this issue" value={swarm.configured?.mode ?? null} resolvedLabel={swarm.resolved.mode} options={[["off", "Off"], ["auto", "Auto"], ["always", "Always"]]} disabled={saving} onChange={(next) => save(`/api/issues/${encoded}/swarm-policy`, { value: next ? { mode: next } : null })} />
              {swarm.configured?.mode && <button type="button" aria-label="Reset swarm mode to default" className={resetClass} disabled={saving} onClick={() => save(`/api/issues/${encoded}/swarm-policy`, { value: null })}>reset</button>}
            </div>
          </div>

          <div className="my-2 grid grid-cols-[92px_1fr] items-center gap-2.5">
            <span className={`${rowLabelClass} ${staffing.tieredExecution.override ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`h-[5px] w-[5px] rounded-full bg-primary ${staffing.tieredExecution.override ? 'opacity-100' : 'opacity-0'}`} /> Standing crew
            </span>
            <div className={controlCellClass}>
              <Segmented
                ariaLabel="Standing crew routing for this issue"
                value={staffing.tieredExecution.override}
                resolvedLabel={`${staffing.tieredExecution.effective ? 'on' : 'off'} (${staffing.tieredExecution.source === 'issue-override' ? 'issue' : staffing.tieredExecution.source === 'plan-metadata' ? 'plan' : 'global'})`}
                options={[["on", "On"], ["off", "Off"]]}
                disabled={saving}
                onChange={(next) => save(`/api/workspaces/${encoded}/tiered-execution`, { override: next }, 'PATCH')}
              />
              {staffing.tieredExecution.override && <button type="button" aria-label="Reset standing crew to default" className={resetClass} disabled={saving} onClick={() => save(`/api/workspaces/${encoded}/tiered-execution`, { override: null }, 'PATCH')}>reset</button>}
            </div>
          </div>

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
        </div>,
        document.body,
      )}
    </span>
  );
}
