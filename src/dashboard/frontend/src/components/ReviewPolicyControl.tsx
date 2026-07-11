/**
 * ReviewPolicyControl — per-issue review mode / re-review scope override (PAN-1874).
 *
 * Compact selects for the issue cockpit header, next to AutoMergeToggle.
 * Reads/writes /api/review/:issueId/config, which persists the override on the
 * per-issue record — the same override `pan review mode` / `pan review scope`
 * set from the CLI. "Project default" (empty) clears the override so the merged
 * per-project → global roles.review config resolves; the resolved value is shown
 * in the option label so the operator always sees what will actually run.
 */
import { useCallback, useEffect, useState } from 'react';

type ReviewModeValue = 'quick' | 'full' | 'none';
type ReReviewScopeValue = 'all' | 'changed' | 'blockers';

interface ReviewConfigResponse {
  override: { reviewMode: ReviewModeValue | null; reReviewScope: ReReviewScopeValue | null };
  resolved: { reviewMode: ReviewModeValue; reReviewScope: ReReviewScopeValue };
}

const selectClass =
  'rounded border border-border bg-popover px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

export function ReviewPolicyControl({ issueId }: { issueId: string }) {
  const [config, setConfig] = useState<ReviewConfigResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/review/${issueId}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.resolved) setConfig(data as ReviewConfigResponse); })
      .catch(() => { /* control simply doesn't render without config */ });
    return () => { cancelled = true; };
  }, [issueId]);

  const save = useCallback(async (patch: { reviewMode?: ReviewModeValue | null; reReviewScope?: ReReviewScopeValue | null }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/review/${issueId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.resolved) setConfig(data as ReviewConfigResponse);
      }
    } catch { /* leave prior state; the operator can retry */ } finally {
      setSaving(false);
    }
  }, [issueId]);

  if (!config) return null;

  return (
    <span className="flex items-center gap-1" data-testid="review-policy-control" title="Per-issue review override (PAN-1874) — beats project/global roles.review config">
      <select
        aria-label="Review mode for this issue"
        className={selectClass}
        disabled={saving}
        value={config.override.reviewMode ?? ''}
        onChange={(e) => save({ reviewMode: (e.target.value || null) as ReviewModeValue | null })}
      >
        <option value="">{`review: default (${config.resolved.reviewMode})`}</option>
        <option value="quick">review: quick</option>
        <option value="full">review: full convoy</option>
        <option value="none">review: none</option>
      </select>
      {config.resolved.reviewMode === 'full' && (
        <select
          aria-label="Re-review scope for this issue"
          className={selectClass}
          disabled={saving}
          value={config.override.reReviewScope ?? ''}
          onChange={(e) => save({ reReviewScope: (e.target.value || null) as ReReviewScopeValue | null })}
        >
          <option value="">{`re-review: default (${config.resolved.reReviewScope})`}</option>
          <option value="changed">re-review: changed</option>
          <option value="all">re-review: all</option>
          <option value="blockers">re-review: blockers</option>
        </select>
      )}
    </span>
  );
}
