import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FlywheelStatePayload {
  exists: boolean;
  path: string;
  content: string | null;
  lastModified: string | null;
}

const REFRESH_INTERVAL_MS = 10000;

async function fetchFlywheelState(): Promise<FlywheelStatePayload> {
  const res = await fetch('/api/flywheel/state');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<FlywheelStatePayload>;
}

function formatLastModified(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function FlywheelStatePane() {
  const [payload, setPayload] = useState<FlywheelStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await fetchFlywheelState();
        if (cancelled) return;
        setPayload(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (loading && !payload) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
        Loading Flywheel state…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load Flywheel state: {error}
      </div>
    );
  }

  if (!payload || !payload.exists || !payload.content) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
        <div>
          <p className="text-base font-medium text-foreground">No Flywheel state yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">docs/FLYWHEEL-STATE.md</code> is created by the orchestrator the first time it records something worth remembering across runs.
          </p>
        </div>
      </div>
    );
  }

  const lastModified = formatLastModified(payload.lastModified);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
        <span className="font-mono">{payload.path}</span>
        {lastModified && <span>Last modified {lastModified}</span>}
      </header>
      <article className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{payload.content}</ReactMarkdown>
      </article>
    </div>
  );
}
