/**
 * The two file-backed rail tabs. Both render a markdown file the loop writes
 * and commits under `<planHome>/.pan/flywheel/`; the page only reads them.
 *
 *   State  (PAN-3964 FR-10) — `state.md`, the loop's cumulative memory.
 *   Report (PAN-4199 WI-15) — `report.md`, what the last stop wrote.
 *
 * One `FlywheelFilePane` serves both, so a change to the loading, error, or
 * empty behaviour can only land in both at once.
 */
import type { ReactNode } from 'react';
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

async function fetchFlywheelFile(endpoint: string): Promise<FlywheelFilePayload> {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`GET ${endpoint} → ${res.status}`);
  return res.json() as Promise<FlywheelFilePayload>;
}

function formatLastModified(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

interface FlywheelFilePaneProps {
  endpoint: string;
  queryKey: readonly string[];
  /** Names the file in the loading and error lines: "flywheel state", "flywheel report". */
  subject: string;
  emptyTitle: string;
  emptyDetail: ReactNode;
  markdownTestId: string;
}

function FlywheelFilePane({ endpoint, queryKey, subject, emptyTitle, emptyDetail, markdownTestId }: FlywheelFilePaneProps) {
  const { data, error, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchFlywheelFile(endpoint),
    refetchInterval: 10_000,
  });

  if (isLoading && !data) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading {subject}…</div>;
  }
  if (error && !data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load {subject}: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data?.exists || !data.content) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  const lastModified = formatLastModified(data.lastModified);
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
        <span className="font-mono">{data.path}</span>
        {lastModified && <span>Last modified {lastModified}</span>}
      </header>
      <article className="prose prose-sm max-w-none dark:prose-invert" data-testid={markdownTestId}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
      </article>
    </div>
  );
}

const FilePath = ({ children }: { children: ReactNode }) => (
  <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
);

export function FlywheelStatePane() {
  return (
    <FlywheelFilePane
      endpoint="/api/flywheel/state"
      queryKey={['flywheel', 'state']}
      subject="flywheel state"
      emptyTitle="No flywheel state yet."
      emptyDetail={<><FilePath>.pan/flywheel/state.md</FilePath> is written and committed by the loop the first time it records a substrate fix or a learning worth keeping across runs.</>}
      markdownTestId="flywheel-state-markdown"
    />
  );
}

export function FlywheelReportPane() {
  return (
    <FlywheelFilePane
      endpoint="/api/flywheel/report"
      queryKey={['flywheel', 'report']}
      subject="flywheel report"
      emptyTitle="No report yet"
      emptyDetail={<><FilePath>.pan/flywheel/report.md</FilePath> is written when the loop stops with a report, or when Report is pressed while it runs.</>}
      markdownTestId="flywheel-report-markdown"
    />
  );
}
