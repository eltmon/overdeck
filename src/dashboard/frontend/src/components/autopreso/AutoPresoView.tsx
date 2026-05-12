import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import '@excalidraw/excalidraw/index.css';

type AutoPresoMode = 'staging' | 'live';
type WarmupStatus = 'idle' | 'warming' | 'ready' | 'failed';
type ExcalidrawElementLike = Record<string, unknown>;
type ExcalidrawApiLike = any;

const Excalidraw = lazy(async () => {
  const mod = await import('@excalidraw/excalidraw');
  return { default: mod.Excalidraw };
});

function AutoPresoControls({
  mode,
  warmupStatus,
  isListening,
  onStart,
  onBackToStaging,
  onReset,
  onToggleMic,
}: {
  mode: AutoPresoMode;
  warmupStatus: WarmupStatus;
  isListening: boolean;
  onStart: () => void;
  onBackToStaging: () => void;
  onReset: () => void;
  onToggleMic: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AutoPreso</p>
          <h2 className="mt-1 text-lg font-semibold">Voice whiteboard</h2>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
          {mode}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleMic}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            isListening ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
          }`}
        >
          {isListening ? 'Stop mic' : 'Start mic'}
        </button>
        <button
          type="button"
          onClick={mode === 'staging' ? onStart : onBackToStaging}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent"
        >
          {mode === 'staging' ? 'Go live' : 'Back to staging'}
        </button>
      </div>

      <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
        <p className="font-medium text-foreground">Warmup: <span className="capitalize">{warmupStatus}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">The whiteboard agent will use the staged canvas as context before live transcription starts.</p>
      </div>

      <label className="mt-4 block text-sm font-medium text-foreground">
        Agent instructions
        <textarea
          className="mt-2 min-h-24 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          placeholder="Describe the diagram style, layout preferences, or constraints for the whiteboard agent."
        />
      </label>

      <button
        type="button"
        onClick={onReset}
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Reset session
      </button>
    </section>
  );
}

function TranscriptPanel({ partialText, turns }: { partialText: string; turns: string[] }) {
  return (
    <section className="min-h-0 flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Transcript</h2>
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1 text-sm">
        {turns.length === 0 && !partialText && (
          <p className="text-muted-foreground">Spoken turns will appear here while AutoPreso listens.</p>
        )}
        {turns.map((turn, index) => (
          <p key={`${index}-${turn}`} className="rounded-lg bg-muted/40 p-2 text-foreground">{turn}</p>
        ))}
        {partialText && <p className="rounded-lg border border-dashed border-border p-2 italic text-muted-foreground">{partialText}</p>}
      </div>
    </section>
  );
}

export function AutoPresoView() {
  const [mode, setMode] = useState<AutoPresoMode>('staging');
  const [warmupStatus, setWarmupStatus] = useState<WarmupStatus>('idle');
  const [isListening, setIsListening] = useState(false);
  const [elements, setElements] = useState<readonly ExcalidrawElementLike[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const excalidrawApiRef = useRef<ExcalidrawApiLike | null>(null);

  const initialData = useMemo(() => ({ elements: elements as readonly never[] }), [elements]);

  const handleStart = useCallback(() => {
    setMode('live');
    setWarmupStatus('warming');
    window.setTimeout(() => setWarmupStatus('ready'), 400);
  }, []);

  const handleBackToStaging = useCallback(() => {
    setMode('staging');
    setWarmupStatus('idle');
  }, []);

  const handleReset = useCallback(() => {
    setMode('staging');
    setWarmupStatus('idle');
    setIsListening(false);
    setTurns([]);
    setElements([]);
    excalidrawApiRef.current?.updateScene?.({ elements: [] });
  }, []);

  const handleToggleMic = useCallback(() => {
    setIsListening((current) => {
      const next = !current;
      if (next) setTurns((existing) => [...existing, 'Listening for voice input…']);
      return next;
    });
  }, []);

  const handleChange = useCallback((nextElements: readonly ExcalidrawElementLike[]) => {
    if (mode === 'staging') setElements(nextElements);
  }, [mode]);

  const handleApi = useCallback((api: ExcalidrawApiLike) => {
    excalidrawApiRef.current = api;
  }, []);

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden bg-background p-4 text-foreground">
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading whiteboard…</div>}>
          <Excalidraw
            excalidrawAPI={handleApi}
            initialData={initialData}
            onChange={handleChange}
            viewModeEnabled={mode === 'live'}
          />
        </Suspense>
      </div>

      <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto">
        <AutoPresoControls
          mode={mode}
          warmupStatus={warmupStatus}
          isListening={isListening}
          onStart={handleStart}
          onBackToStaging={handleBackToStaging}
          onReset={handleReset}
          onToggleMic={handleToggleMic}
        />
        <TranscriptPanel
          turns={turns}
          partialText={isListening ? 'Waiting for speech…' : ''}
        />
      </aside>
    </div>
  );
}
