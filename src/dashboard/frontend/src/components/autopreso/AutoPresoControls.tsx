import type { AutoPresoMode, WarmupStatus } from '../../hooks/useAutoPresoWebSocket';

export function AutoPresoControls({
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
        <p className="font-medium text-foreground">
          Warmup: <span className="capitalize">{warmupStatus}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">The whiteboard agent uses the staged canvas as context before live transcription starts.</p>
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
