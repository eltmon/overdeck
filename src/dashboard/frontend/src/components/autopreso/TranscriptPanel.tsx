import { useEffect, useRef } from 'react';
import type { TranscriptTurn } from '../../hooks/useAutoPresoWebSocket';

export type { TranscriptTurn };

export function TranscriptPanel({ partialText, turns }: { partialText: string; turns: TranscriptTurn[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [partialText, turns]);

  return (
    <section className="min-h-0 flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Transcript</h2>
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1 text-sm">
        {turns.length === 0 && !partialText && (
          <p className="text-muted-foreground">Spoken turns will appear here while AutoPreso listens.</p>
        )}
        {turns.map((turn, index) => (
          <article key={`${turn.timestamp.toISOString()}-${index}`} className="rounded-lg bg-muted/40 p-2 text-foreground">
            <time className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {turn.timestamp.toLocaleTimeString()}
            </time>
            <p>{turn.text}</p>
          </article>
        ))}
        {partialText && (
          <p className="rounded-lg border border-dashed border-border p-2 italic text-muted-foreground">{partialText}</p>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
