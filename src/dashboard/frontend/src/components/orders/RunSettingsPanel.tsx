import { useEffect, useState } from 'react';
import type { OrderBookSettings } from '@overdeck/contracts';

interface RunSettingsPanelProps {
  settings: OrderBookSettings;
  onChange: (patch: Partial<OrderBookSettings>) => Promise<void>;
}

export function RunSettingsPanel({ settings, onChange }: RunSettingsPanelProps) {
  const [concurrency, setConcurrency] = useState(String(settings.laneAConcurrency));
  const [briefOverlay, setBriefOverlay] = useState(settings.briefOverlay ?? '');
  const [postureReason, setPostureReason] = useState(settings.postureReason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setConcurrency(String(settings.laneAConcurrency)), [settings.laneAConcurrency]);
  useEffect(() => setBriefOverlay(settings.briefOverlay ?? ''), [settings.briefOverlay]);
  useEffect(() => setPostureReason(settings.postureReason ?? ''), [settings.postureReason]);

  const save = async (patch: Partial<OrderBookSettings>) => {
    setSaving(true);
    setError(null);
    try {
      await onChange(patch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Run settings">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Run settings</h2>
      <div className="mt-3 grid gap-3 text-xs">
        <label className="flex items-center gap-3">
          <span className="flex-1 text-muted-foreground">Lane A concurrency</span>
          <input
            aria-label="Lane A concurrency"
            type="number"
            min={1}
            value={concurrency}
            onChange={(event) => setConcurrency(event.target.value)}
            onBlur={() => {
              const value = Number(concurrency);
              if (Number.isInteger(value) && value > 0 && value !== settings.laneAConcurrency) void save({ laneAConcurrency: value });
            }}
            className="w-16 rounded-md border border-input bg-background px-2 py-1 text-right font-mono text-foreground"
          />
        </label>
        <label className="flex items-center gap-3">
          <span className="flex-1 text-muted-foreground">Brief overlay</span>
          <input
            aria-label="Brief overlay"
            value={briefOverlay}
            onChange={(event) => setBriefOverlay(event.target.value)}
            onBlur={() => {
              if (briefOverlay !== (settings.briefOverlay ?? '')) void save({ briefOverlay });
            }}
            placeholder="Optional markdown path"
            className="min-w-56 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px] text-foreground"
          />
        </label>
        <label className="flex items-center gap-3">
          <span className="flex-1 text-muted-foreground">Posture reason</span>
          <input
            aria-label="Posture reason"
            value={postureReason}
            onChange={(event) => setPostureReason(event.target.value)}
            placeholder="Why pickup is open or draining"
            className="min-w-56 rounded-md border border-input bg-background px-2 py-1 text-[11px] text-foreground"
          />
        </label>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-muted-foreground">Pickup posture</span>
          <div className="flex gap-1">
            {(['open', 'drain'] as const).map((posture) => (
              <button
                key={posture}
                type="button"
                aria-pressed={settings.posture === posture}
                disabled={saving || settings.posture === posture}
                onClick={() => void save({
                  posture,
                  postureReason: postureReason.trim() || (posture === 'drain' ? 'Operator paused new pickup.' : 'Operator reopened pickup.'),
                })}
                className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide ${posture === 'drain' && settings.posture === posture ? 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground' : 'border-border text-muted-foreground'}`}
              >
                {posture}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="flex-1 text-muted-foreground">Off-book policy</span>
          <span className="max-w-72 text-right text-[11px] text-muted-foreground">Blocked by default; an operator must use the explicit logged <span className="font-mono text-foreground">--off-book</span> override.</span>
        </div>
      </div>
      {saving && <p className="mt-2 text-[11px] text-muted-foreground" role="status">Saving settings…</p>}
      {error && <p className="mt-2 text-[11px] text-destructive" role="alert">{error}</p>}
    </section>
  );
}
