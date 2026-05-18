import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { AutoPresoMode, WarmupStatus } from '../../hooks/useAutoPresoWebSocket';

function warmupIcon(status: WarmupStatus) {
  if (status === 'warming') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'failed') return <AlertCircle className="h-4 w-4 text-destructive" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export function AutoPresoControls({
  mode,
  warmupStatus,
  isListening,
  onStart,
  onBackToStaging,
  onReset,
  onToggleMic,
  voiceError,
}: {
  mode: AutoPresoMode;
  warmupStatus: WarmupStatus;
  isListening: boolean;
  onStart: () => void;
  onBackToStaging: () => void;
  onReset: () => void;
  onToggleMic: () => void;
  voiceError: string | null;
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
        <p className="flex items-center gap-2 font-medium text-foreground">
          {warmupIcon(warmupStatus)}
          Warmup: <span className="capitalize">{warmupStatus}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">The whiteboard agent uses the staged canvas as context before live transcription starts.</p>
      </div>

      {voiceError && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {voiceError}
        </div>
      )}

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
