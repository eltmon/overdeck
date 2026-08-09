import { useEffect, useState } from 'react';
import type { OrderBookLane } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import type { OrderBookView } from './BookStrip';
import { withProject } from './projectScope';

interface BacklogCandidate {
  issue: string;
  rank: number;
  why: string;
}

interface BacklogCandidatesRailProps {
  book: OrderBookView;
  onBookChange: (book: OrderBookView) => void;
  project?: string | null;
}

export function BacklogCandidatesRail({ book, onBookChange, project }: BacklogCandidatesRailProps) {
  const [candidates, setCandidates] = useState<BacklogCandidate[]>([]);
  const [lane, setLane] = useState<OrderBookLane>('A');
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetch(withProject('/api/orders/backlog-candidates?limit=10', project))
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { candidates?: BacklogCandidate[]; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? `Could not load backlog candidates (${response.status})`);
        return payload?.candidates ?? [];
      })
      .then((items) => {
        if (!current) return;
        const inBook = new Set(book.items.map((item) => item.issue.toUpperCase()));
        setCandidates(items.filter((item) => !inBook.has(item.issue.toUpperCase())).sort((left, right) => left.rank - right.rank).slice(0, 10));
      })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [book.id, book.items, project]);

  const add = async (issueId: string) => {
    setAdding(issueId);
    setError(null);
    try {
      const response = await fetch(withProject(`/api/orders/${encodeURIComponent(book.id)}/items`, project), {
        method: 'POST', credentials: 'include', headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ item: { issue: issueId, lane } }),
      });
      const payload = await response.json().catch(() => null) as (OrderBookView & { error?: string }) | null;
      if (!response.ok) throw new Error(payload?.error ?? `Could not add ${issueId} (${response.status})`);
      onBookChange(payload as OrderBookView);
      setCandidates((current) => current.filter((candidate) => candidate.issue !== issueId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label="Backlog candidates">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Backlog top 10</h2>
        <div className="ml-auto flex rounded-md border border-border p-0.5 text-[10px]">
          {(['A', 'B'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setLane(value)} aria-pressed={lane === value} className={`rounded-sm px-2 py-0.5 ${lane === value ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>Lane {value}</button>
          ))}
        </div>
      </div>
      <div className="mt-2 grid gap-1">
        {candidates.map((candidate) => (
          <div key={candidate.issue} className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0">
            <span data-testid="sequence-rank" className="w-6 shrink-0 text-[10px] text-muted-foreground">#{candidate.rank}</span>
            <span className="w-20 shrink-0 font-mono text-[11px] text-foreground">{candidate.issue}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{candidate.why}</span>
            <button type="button" disabled={adding === candidate.issue} onClick={() => void add(candidate.issue)} className="w-16 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50">
              {adding === candidate.issue ? 'Adding…' : `+ ${lane}`}
            </button>
          </div>
        ))}
        {candidates.length === 0 && !error && <p className="py-2 text-xs text-muted-foreground">No unassigned backlog candidates.</p>}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Sequencer rank informs planning order; order-book lane position governs this run.</p>
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}
