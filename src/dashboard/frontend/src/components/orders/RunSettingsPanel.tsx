import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { OrderBookSettings, OrderBookPosture } from '@overdeck/contracts';

const POSTURE_DEFAULT_REASON: Record<OrderBookPosture, string> = {
  drain: 'Operator paused new pickup.',
  open: 'Operator reopened pickup.',
};

const POSTURE_CONSEQUENCE: Record<OrderBookPosture, string> = {
  drain: 'In-flight items will finish. Nothing new dispatches from this book until it is reopened.',
  open: 'Eligible items will start dispatching again — Lane A up to its concurrency, Lane B one at a time in order.',
};

const POSTURE_HINT: Record<OrderBookPosture, string> = {
  open: 'Dispatch is live: eligible items start when a slot frees, Lane B strictly in order.',
  drain: 'Draining: in-flight items finish, nothing new starts until reopened.',
};

const POSTURE_CONFIRM_LABEL: Record<OrderBookPosture, string> = {
  drain: 'Switch to drain',
  open: 'Reopen pickup',
};

const POSTURE_ACTIVE_CLASSES: Record<OrderBookPosture, string> = {
  open: 'border-info/[0.32] bg-info/[0.08] text-info-foreground',
  drain: 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground',
};

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

function formatPostureSetAt(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${datePart}, ${hh}:${mm}Z`;
}

function isStalePostureReason(posture: OrderBookPosture, reason: string | undefined): boolean {
  return (
    (posture === 'open' && reason === POSTURE_DEFAULT_REASON.drain) ||
    (posture === 'drain' && reason === POSTURE_DEFAULT_REASON.open)
  );
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

const LANE_A_MIN = 1;
const LANE_A_MAX = 8;
const LANE_A_DEBOUNCE_MS = 500;
const BRIEF_DEBOUNCE_MS = 550;
const BRIEF_MD_PATTERN = /\.md$/i;

export function RunSettingsPanel({ settings, onChange }: RunSettingsPanelProps) {
  const [concurrency, setConcurrency] = useState(settings.laneAConcurrency);
  const [briefOverlay, setBriefOverlay] = useState(settings.briefOverlay ?? '');
  const [pendingTo, setPendingTo] = useState<OrderBookPosture | null>(null);
  const [offbookExpanded, setOffbookExpanded] = useState(false);
  const [confirmReason, setConfirmReason] = useState('');
  const [saves, setSaves] = useState<Record<FieldId, SaveState>>({
    posture: { state: 'idle' },
    lane: { state: 'idle' },
    brief: { state: 'idle' },
  });
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const savedTimers = useRef<Record<FieldId, ReturnType<typeof setTimeout> | undefined>>({} as never);
  const confirmReasonInputRef = useRef<HTMLInputElement | null>(null);
  const laneDebounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const briefDebounceTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setConcurrency(settings.laneAConcurrency), [settings.laneAConcurrency]);
  useEffect(() => setBriefOverlay(settings.briefOverlay ?? ''), [settings.briefOverlay]);

  const trimmedBrief = briefOverlay.trim();
  const briefStatus: { text: string; tone: 'muted' | 'success' | 'error' } =
    trimmedBrief === ''
      ? { text: 'None — items run with their PRDs alone.', tone: 'muted' }
      : BRIEF_MD_PATTERN.test(trimmedBrief)
        ? { text: "Appended to every item's kickoff brief.", tone: 'success' }
        : { text: 'Not a markdown file — expected a repo-relative .md path.', tone: 'error' };

  useEffect(() => {
    if (pendingTo) confirmReasonInputRef.current?.select();
  }, [pendingTo]);

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

  const handleBriefChange = (value: string) => {
    setBriefOverlay(value);
    clearTimeout(briefDebounceTimer.current);
    briefDebounceTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      const persisted = settings.briefOverlay ?? '';
      if (trimmed === '') {
        if (persisted !== '') runSave('brief', { briefOverlay: '' });
        return;
      }
      if (!BRIEF_MD_PATTERN.test(trimmed)) return;
      if (trimmed !== persisted) runSave('brief', { briefOverlay: trimmed });
    }, BRIEF_DEBOUNCE_MS);
  };

  const adjustConcurrency = (delta: number) => {
    setConcurrency((current) => {
      const next = Math.min(LANE_A_MAX, Math.max(LANE_A_MIN, current + delta));
      clearTimeout(laneDebounceTimer.current);
      laneDebounceTimer.current = setTimeout(() => runSave('lane', { laneAConcurrency: next }), LANE_A_DEBOUNCE_MS);
      return next;
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Run settings">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Run settings</h2>
      <div className="mt-3 grid gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <span className="text-muted-foreground">Lane A concurrency</span>
            <p className="text-[11px] text-muted-foreground">How many parallel-safe Lane A items may run at once. Lane B ignores this — it is always one item at a time, in order.</p>
          </div>
          <SaveChip save={saves.lane} />
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Decrease Lane A concurrency"
              disabled={concurrency <= LANE_A_MIN}
              onClick={() => adjustConcurrency(-1)}
              className="rounded-md border border-input px-2 py-1 text-foreground disabled:opacity-40"
            >
              −
            </button>
            <span className="w-4 text-center font-mono tabular-nums text-foreground">{concurrency}</span>
            <button
              type="button"
              aria-label="Increase Lane A concurrency"
              disabled={concurrency >= LANE_A_MAX}
              onClick={() => adjustConcurrency(1)}
              className="rounded-md border border-input px-2 py-1 text-foreground disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-muted-foreground">Brief overlay</span>
            <SaveChip save={saves.brief} />
            <input
              aria-label="Brief overlay"
              value={briefOverlay}
              onChange={(event) => handleBriefChange(event.target.value)}
              placeholder="docs/briefs/refactor-p3.md"
              className="min-w-56 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px] text-foreground"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">Markdown appended to every item&apos;s kickoff brief for this run.</p>
          <p
            className={`text-[11px] ${briefStatus.tone === 'error' ? 'text-destructive' : briefStatus.tone === 'success' ? 'text-success' : 'text-muted-foreground'}`}
          >
            {briefStatus.text}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-muted-foreground">Pickup posture</span>
            <SaveChip save={saves.posture} />
            <div className="flex gap-1">
              {(['open', 'drain'] as const).map((posture) => (
                <button
                  key={posture}
                  type="button"
                  aria-pressed={settings.posture === posture}
                  onClick={() => {
                    if (posture === settings.posture) return;
                    setPendingTo(posture);
                    setConfirmReason(POSTURE_DEFAULT_REASON[posture]);
                  }}
                  className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide ${settings.posture === posture ? POSTURE_ACTIVE_CLASSES[posture] : 'border-border text-muted-foreground'}`}
                >
                  {posture}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{POSTURE_HINT[settings.posture]}</p>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="capitalize text-foreground">{settings.posture}</span>
            <span>· set by</span>
            <span className="font-mono text-foreground">{settings.postureSetBy ?? 'operator'}</span>
            {settings.postureSetAt && <span>· {formatPostureSetAt(settings.postureSetAt)}</span>}
            <span>— &quot;{settings.postureReason ?? 'No reason recorded.'}&quot;</span>
            {isStalePostureReason(settings.posture, settings.postureReason) && (
              <span
                className="rounded-sm border border-warning/[0.32] bg-warning/[0.08] px-1 py-0.5 text-[10px] uppercase text-warning-foreground"
                title="This reason was recorded before the current posture was set — it describes a previous state."
              >
                stale reason
              </span>
            )}
          </div>
          {pendingTo && (
            <div className={`flex flex-col gap-2 rounded-md border p-2 ${POSTURE_ACTIVE_CLASSES[pendingTo]}`}>
              <p className="text-[11px]">{POSTURE_CONSEQUENCE[pendingTo]}</p>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Why? Recorded on the run and shown to anyone reading this book.</span>
                <input
                  ref={confirmReasonInputRef}
                  aria-label="Posture reason"
                  value={confirmReason}
                  onChange={(event) => setConfirmReason(event.target.value)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-[11px] text-foreground"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    runSave('posture', {
                      posture: pendingTo,
                      postureReason: confirmReason.trim() || POSTURE_DEFAULT_REASON[pendingTo],
                    });
                    setPendingTo(null);
                  }}
                  className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide ${POSTURE_ACTIVE_CLASSES[pendingTo]}`}
                >
                  {POSTURE_CONFIRM_LABEL[pendingTo]}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingTo(null)}
                  className="rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-muted-foreground">Off-book pickup</span>
            <button
              type="button"
              aria-expanded={offbookExpanded}
              onClick={() => setOffbookExpanded((expanded) => !expanded)}
              className="text-[11px] text-muted-foreground underline"
            >
              how the override works
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">🔒 Blocked while this book runs — fixed policy, not a preference.</p>
          {offbookExpanded && (
            <p className="text-[11px] text-muted-foreground">
              While a run is active the flywheel only starts issues that are in this book. Starting anything else requires{' '}
              <span className="font-mono text-foreground">pan start &lt;id&gt; --off-book</span>, which succeeds but is written to
              the run record with who ran it and when — an audited exception, not a setting.
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
        <span>Changes save automatically</span>
        <span className="font-mono">{lastSaved ? `last saved ${formatTimeUtc(lastSaved)}` : 'last saved —'}</span>
      </div>
    </section>
  );
}
