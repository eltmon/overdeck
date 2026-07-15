/** Shared per-issue review and staffing policy strip (PAN-2674). */
import { useCallback, useEffect, useMemo, useState } from 'react';

type ReviewModeValue = 'quick' | 'full' | 'none';
type ReReviewScopeValue = 'all' | 'changed' | 'blockers';
type SwarmMode = 'off' | 'auto' | 'always';

interface ReviewConfigResponse {
  override: { reviewMode: ReviewModeValue | null; reReviewScope: ReReviewScopeValue | null; reviewModel: string | null };
  resolved: { reviewMode: ReviewModeValue; reReviewScope: ReReviewScopeValue; reviewModel: string };
}

interface StaffingResponse {
  override: { workModel: string | null };
  resolved: { model: string; tiered: boolean; source: 'issue' | 'default'; recordedModel: string | null };
}

interface SwarmResponse {
  configured: { mode?: SwarmMode } | null;
  resolved: { mode: SwarmMode; source: { mode: string } };
}

interface AvailableModel { id: string; name: string }
type AvailableModelsResponse = Record<string, AvailableModel[]>;

const selectClass =
  'rounded border bg-popover px-1.5 py-0.5 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

export function IssuePolicyStrip({ issueId }: { issueId: string }) {
  const [review, setReview] = useState<ReviewConfigResponse | null>(null);
  const [staffing, setStaffing] = useState<StaffingResponse | null>(null);
  const [swarm, setSwarm] = useState<SwarmResponse | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModelsResponse>({});
  const [saving, setSaving] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

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

  const save = useCallback(async (url: string, body: unknown) => {
    setSaving(true);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  if (!review || !staffing || !swarm) return null;
  const encoded = encodeURIComponent(issueId);
  const workDefault = staffing.resolved.tiered ? 'tiered' : staffing.resolved.model;
  const needsRestart = Boolean(
    staffing.override.workModel && staffing.override.workModel !== staffing.resolved.recordedModel,
  );

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

  return (
    <span className="flex flex-col gap-1" data-testid="issue-policy-strip" title="Per-issue review and staffing overrides">
      <span className="flex flex-wrap items-center gap-1">
        <select aria-label="Review mode for this issue" className={`${selectClass} ${review.override.reviewMode ? 'border-primary' : 'border-border'}`} disabled={saving} value={review.override.reviewMode ?? ''} onChange={(event) => save(`/api/review/${encoded}/config`, { reviewMode: event.target.value || null })}>
          <option value="">{`review: default (${review.resolved.reviewMode})`}</option>
          <option value="quick">review: quick</option><option value="full">review: full convoy</option><option value="none">review: none</option>
        </select>
        {review.resolved.reviewMode === 'full' && (
          <select aria-label="Re-review scope for this issue" className={`${selectClass} ${review.override.reReviewScope ? 'border-primary' : 'border-border'}`} disabled={saving} value={review.override.reReviewScope ?? ''} onChange={(event) => save(`/api/review/${encoded}/config`, { reReviewScope: event.target.value || null })}>
            <option value="">{`re-review: default (${review.resolved.reReviewScope})`}</option>
            <option value="changed">re-review: changed</option><option value="all">re-review: all</option><option value="blockers">re-review: blockers</option>
          </select>
        )}
        <select aria-label="Review model for this issue" className={`${selectClass} ${review.override.reviewModel ? 'border-primary' : 'border-border'}`} disabled={saving} value={review.override.reviewModel ?? ''} onChange={(event) => save(`/api/review/${encoded}/config`, { reviewModel: event.target.value || null })}>
          <option value="">{`reviewers: default (${review.resolved.reviewModel})`}</option>
          {models.map((model) => <option key={model.id} value={model.id}>{`reviewers: ${model.name}`}</option>)}
        </select>
        <select aria-label="Work model for this issue" className={`${selectClass} ${staffing.override.workModel ? 'border-primary' : 'border-border'}`} disabled={saving} value={staffing.override.workModel ?? ''} onChange={(event) => save(`/api/issues/${encoded}/staffing`, { workModel: event.target.value || null })}>
          <option value="">{`work: default (${workDefault})`}</option>
          {models.map((model) => <option key={model.id} value={model.id}>{`work: ${model.name}`}</option>)}
        </select>
        <select aria-label="Swarm mode for this issue" className={`${selectClass} ${swarm.configured?.mode ? 'border-primary' : 'border-border'}`} disabled={saving} value={swarm.configured?.mode ?? ''} onChange={(event) => save(`/api/issues/${encoded}/swarm-policy`, { value: event.target.value ? { mode: event.target.value } : null })}>
          <option value="">{`swarm: default (${swarm.resolved.mode})`}</option>
          <option value="off">swarm: off</option><option value="auto">swarm: auto</option><option value="always">swarm: always</option>
        </select>
      </span>
      {needsRestart && (
        <span className="flex flex-wrap items-center gap-2 border-l-2 border-warning pl-2 text-[11px] font-medium text-warning">
          The work-model override applies to the next spawn; running agents are never restarted automatically.
          <button type="button" className="rounded border border-warning px-1.5 py-0.5 hover:bg-warning/10 disabled:opacity-50" disabled={saving} onClick={restart}>Restart agent with new staffing</button>
          {restartMessage && <span>{restartMessage}</span>}
        </span>
      )}
    </span>
  );
}
