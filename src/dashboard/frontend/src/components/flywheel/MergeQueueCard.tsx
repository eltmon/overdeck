/**
 * MergeQueueCard — the Flywheel rail's centerpiece (PAN-1691/1694 v3).
 *
 * Renders the conflict-aware merge order as the approved v3 mockup does: the
 * batch-safe features grouped under a single "UAT candidate" header (with an
 * Assemble action), the serialized features listed below, and a "Merge next
 * [N] · Ship batch" stepper. Wires to the merge-train endpoints
 * (/api/flywheel/merge-queue, /uat-candidate, /merge-next, /assemble-uat).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { RailCard } from './RailCard';

interface MergeQueueItem {
  issueId: string;
  title: string;
  pr?: number;
  mergeOrder: number;
  conflictsWith: string[];
  batchGroup?: 'batch' | 'serialize';
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export function MergeQueueCard({ active, onNavigateIssue }: { active: boolean; onNavigateIssue?: (issueId: string) => void }) {
  const queryClient = useQueryClient();
  const [mergeN, setMergeN] = useState(1);

  const mergeQueueQuery = useQuery({
    queryKey: ['flywheel-merge-queue'],
    queryFn: () => fetchJson<MergeQueueItem[]>('/api/flywheel/merge-queue'),
    refetchInterval: active ? 15000 : false,
  });
  const uatCandidateQuery = useQuery({
    queryKey: ['flywheel-uat-candidate'],
    queryFn: () => fetchJson<{ branchName: string | null; bundled: string[] }>('/api/flywheel/uat-candidate'),
    refetchInterval: active ? 15000 : false,
  });

  const mergeQueue = Array.isArray(mergeQueueQuery.data) ? mergeQueueQuery.data : [];
  const uatCandidate = uatCandidateQuery.data;

  const mergeNextMutation = useMutation({
    mutationFn: async (n: number) => {
      const res = await fetch('/api/flywheel/merge-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `merge-next failed (${res.status})`);
      }
      return (await res.json()) as { outcomes: Array<{ issueId: string; result: string; reason?: string }> };
    },
    onSuccess: (data) => {
      const merged = data.outcomes.filter((o) => o.result === 'merged').length;
      const failed = data.outcomes.find((o) => o.result === 'failed');
      if (failed) toast.warning(`Merged ${merged}, then ${failed.issueId} stopped the batch: ${failed.reason ?? ''}`);
      else toast.success(`Merged ${merged} issue${merged === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['flywheel-merge-queue'] });
      queryClient.invalidateQueries({ queryKey: ['flywheel-uat-candidate'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'merge-next failed'),
  });
  const assembleUatMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/flywheel/assemble-uat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `assemble failed (${res.status})`);
      }
      return (await res.json()) as { branch: string | null; merged: string[]; conflicts: Array<{ branch: string; reason: string }> };
    },
    onSuccess: (data) => {
      if (!data.branch) { toast.info('No batch-safe bundle to assemble'); return; }
      const c = data.conflicts.length;
      const msg = `Assembled ${data.branch} — ${data.merged.length} merged${c ? `, ${c} conflict${c === 1 ? '' : 's'}` : ''}`;
      if (c > 0) toast.warning(msg); else toast.success(msg);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'assemble failed'),
  });

  const batched = mergeQueue.filter((i) => i.batchGroup === 'batch');
  const serial = mergeQueue.filter((i) => i.batchGroup !== 'batch');
  const hasCandidate = !!uatCandidate?.branchName && (uatCandidate.bundled.length > 0 || batched.length > 0);
  const cap = Math.max(1, mergeQueue.length);
  const n = Math.min(mergeN, cap);

  const IdLink = ({ issueId }: { issueId: string }) => (
    <button
      type="button"
      onClick={() => onNavigateIssue?.(issueId)}
      className="font-mono text-[11px] font-semibold text-primary hover:underline"
    >
      {issueId}
    </button>
  );

  return (
    <RailCard
      icon={<GitMerge className="h-3.5 w-3.5 text-emerald-400" />}
      label="Merge queue"
      ariaLabel="Merge queue"
      count={mergeQueue.length > 0 ? `${mergeQueue.length} ready` : undefined}
    >
      {mergeQueue.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">No branches ready to merge.</p>
      ) : (
        <div className="space-y-2">
          {hasCandidate && (
            <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/[0.04] p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                  <Zap className="h-3 w-3" /> UAT candidate
                </span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{uatCandidate!.branchName}</span>
              </div>
              {(batched.length > 0 ? batched : mergeQueue.filter((i) => uatCandidate!.bundled.includes(i.issueId))).map((item) => (
                <div key={item.issueId} className="ml-0.5 flex items-center gap-2 border-l-2 border-emerald-500/30 py-0.5 pl-3 text-[11.5px]">
                  <IdLink issueId={item.issueId} />
                  {item.pr != null && <span className="text-[10.5px] text-muted-foreground">#{item.pr}</span>}
                  <span className="truncate text-muted-foreground">{item.title}</span>
                </div>
              ))}
              <div className="mt-1.5 flex items-center justify-between gap-2 pl-3">
                <span className="text-[10px] text-muted-foreground">{(uatCandidate!.bundled.length || batched.length)} batch-safe</span>
                <button
                  type="button"
                  disabled={assembleUatMutation.isPending}
                  onClick={() => assembleUatMutation.mutate()}
                  title="Create the uat/<codename>-<date> branch and merge this bundle onto it for UAT"
                  className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                >
                  {assembleUatMutation.isPending ? 'Assembling…' : 'Assemble'}
                </button>
              </div>
            </div>
          )}

          {serial.map((item) => (
            <div key={item.issueId} className="flex items-center gap-2 border-t border-border py-1.5 text-[11.5px] first:border-t-0">
              <IdLink issueId={item.issueId} />
              {item.pr != null && <span className="text-[10.5px] text-muted-foreground">#{item.pr}</span>}
              <span className="flex-1 truncate text-muted-foreground">{item.title}</span>
              {item.batchGroup === 'serialize' && (
                <span
                  className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400"
                  title={item.conflictsWith.length > 0 ? `File overlap with: ${item.conflictsWith.join(', ')}` : 'Must merge one at a time'}
                >
                  serial
                </span>
              )}
            </div>
          ))}

          <div className="mt-1 flex items-center gap-2 border-t border-dashed border-border pt-2.5 text-[11px] text-muted-foreground">
            <span>Merge next</span>
            <span className="inline-flex items-center overflow-hidden rounded-md border border-border">
              <button type="button" className="h-5 w-5 bg-background hover:bg-accent" onClick={() => setMergeN((v) => Math.max(1, v - 1))}>−</button>
              <span className="w-6 text-center font-bold text-foreground">{n}</span>
              <button type="button" className="h-5 w-5 bg-background hover:bg-accent" onClick={() => setMergeN((v) => Math.min(cap, v + 1))}>+</button>
            </span>
            <button
              type="button"
              disabled={mergeNextMutation.isPending}
              onClick={() => mergeNextMutation.mutate(n)}
              className="ml-auto rounded-md bg-emerald-500 px-3 py-1 text-[11px] font-bold text-emerald-950 hover:brightness-110 disabled:opacity-50"
            >
              {mergeNextMutation.isPending ? 'Merging…' : 'Ship batch'}
            </button>
          </div>
        </div>
      )}
    </RailCard>
  );
}
