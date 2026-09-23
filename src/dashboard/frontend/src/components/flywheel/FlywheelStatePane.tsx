/**
 * State tab (PAN-3964 FR-10): the loop's cumulative memory,
 * `<planHome>/.pan/flywheel/state.md`, rendered as markdown. The loop writes
 * and commits the file; the page only reads it.
 */
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { EmptyState } from './primitives';

export interface FlywheelFilePayload {
  exists: boolean;
  path: string;
  content: string | null;
  lastModified: string | null;
}

async function fetchFlywheelState(): Promise<FlywheelFilePayload> {
  const res = await fetch('/api/flywheel/state');
  if (!res.ok) throw new Error(`GET /api/flywheel/state → ${res.status}`);
  return res.json() as Promise<FlywheelFilePayload>;
}

function formatLastModified(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function FlywheelStatePane() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['flywheel', 'state'],
    queryFn: fetchFlywheelState,
    refetchInterval: 10_000,
  });

  if (isLoading && !data) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading flywheel state…</div>;
  }
  if (error && !data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load flywheel state: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data?.exists || !data.content) {
    return (
      <EmptyState
        title="No flywheel state yet."
        detail={<><code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">.pan/flywheel/state.md</code> is written and committed by the loop the first time it records a substrate fix or a learning worth keeping across runs.</>}
      />
    );
  }

  const lastModified = formatLastModified(data.lastModified);
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
        <span className="font-mono">{data.path}</span>
        {lastModified && <span>Last modified {lastModified}</span>}
      </header>
      <article className="prose prose-sm max-w-none dark:prose-invert" data-testid="flywheel-state-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
      </article>
    </div>
  );
}
