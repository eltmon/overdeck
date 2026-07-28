import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { OrderBookSettings } from '@overdeck/contracts';

interface RunSettingsPanelProps {
  settings: OrderBookSettings;
  onChange: (patch: Partial<OrderBookSettings>) => Promise<void>;
}

type FieldId = 'posture' | 'lane' | 'brief';
type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; retry: () => void };

const SAVED_FADE_MS = 1600;

function formatTimeUtc(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}Z`;
}

function SaveChip({ save }: { save: SaveState }) {
  if (save.state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" role="status">
        <Loader2 size={10} className="animate-spin" />
        Saving…
      </span>
    );
  }
  if (save.state === 'saved') {
    return (
      <span className="text-[10px] text-success" role="status">
        Saved ✓
      </span>
    );
  }
  if (save.state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive" role="alert">
        Couldn&apos;t save
        <button type="button" onClick={save.retry} className="underline">
          Retry
        </button>
      </span>
    );
  }
  return null;
}

export function RunSettingsPanel({ settings, onChange }: RunSettingsPanelProps) {
  const [concurrency, setConcurrency] = useState(String(settings.laneAConcurrency));
  const [briefOverlay, setBriefOverlay] = useState(settings.briefOverlay ?? '');
  const [postureReason, setPostureReason] = useState(settings.postureReason ?? '');
  const [saves, setSaves] = useState<Record<FieldId, SaveState>>({
    posture: { state: 'idle' },
    lane: { state: 'idle' },
    brief: { state: 'idle' },
  });
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const savedTimers = useRef<Record<FieldId, ReturnType<typeof setTimeout> | undefined>>({} as never);

  useEffect(() => setConcurrency(String(settings.laneAConcurrency)), [settings.laneAConcurrency]);
  useEffect(() => setBriefOverlay(settings.briefOverlay ?? ''), [settings.briefOverlay]);
  useEffect(() => setPostureReason(settings.postureReason ?? ''), [settings.postureReason]);

  const runSave = (field: FieldId, patch: Partial<OrderBookSettings>) => {
    clearTimeout(savedTimers.current[field]);
    setSaves((s) => ({ ...s, [field]: { state: 'saving' } }));
    void onChange(patch).then(
      () => {
        setLastSaved(new Date());
        setSaves((s) => ({ ...s, [field]: { state: 'saved' } }));
        savedTimers.current[field] = setTimeout(
          () => setSaves((s) => ({ ...s, [field]: { state: 'idle' } })),
          SAVED_FADE_MS,
        );
      },
      () => setSaves((s) => ({ ...s, [field]: { state: 'error', retry: () => runSave(field, patch) } })),
    );
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Run settings">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Run settings</h2>
      <div className="mt-3 grid gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-muted-foreground">Lane A concurrency</span>
          <SaveChip save={saves.lane} />
          <input
            aria-label="Lane A concurrency"
            type="number"
            min={1}
            value={concurrency}
            onChange={(event) => setConcurrency(event.target.value)}
            onBlur={() => {
              const value = Number(concurrency);
              if (Number.isInteger(value) && value > 0 && value !== settings.laneAConcurrency) runSave('lane', { laneAConcurrency: value });
            }}
            className="w-16 rounded-md border border-input bg-background px-2 py-1 text-right font-mono text-foreground"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-muted-foreground">Brief overlay</span>
          <SaveChip save={saves.brief} />
          <input
            aria-label="Brief overlay"
            value={briefOverlay}
            onChange={(event) => setBriefOverlay(event.target.value)}
            onBlur={() => {
              if (briefOverlay !== (settings.briefOverlay ?? '')) runSave('brief', { briefOverlay });
            }}
            placeholder="Optional markdown path"
            className="min-w-56 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px] text-foreground"
          />
        </div>
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
          <SaveChip save={saves.posture} />
          <div className="flex gap-1">
            {(['open', 'drain'] as const).map((posture) => (
              <button
                key={posture}
                type="button"
                aria-pressed={settings.posture === posture}
                disabled={settings.posture === posture}
                onClick={() => runSave('posture', {
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
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
        <span>Changes save automatically</span>
        <span className="font-mono">{lastSaved ? `last saved ${formatTimeUtc(lastSaved)}` : 'last saved —'}</span>
      </div>
    </section>
  );
}
