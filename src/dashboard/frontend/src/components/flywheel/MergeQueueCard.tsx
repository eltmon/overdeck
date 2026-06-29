/**
 * UAT batches card (PAN-1737) — the Flywheel rail's centerpiece, rebuilt
 * around UAT batch trains per the approved mockup
 * (docs/design/pan-1737-uat-batch-trains.html).
 *
 * Zones: plain-language intro · batches newest-first (ready / assembling /
 * superseded, with live frontend + promote actions) · per-member "What to
 * UAT" checklist (acceptance criteria from each issue's plan, with explicit
 * verify-the-touchpoint items where the assembly agent resolved a conflict) ·
 * ready-features reference rows (branch + PR) · a single-feature escape hatch.
 *
 * Honest-language contract: every action names its exact effect and confirms
 * via useConfirm() before anything fires. Merging a batch lands exactly the
 * tree the operator tested.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { RailCard } from './RailCard';
import { useConfirm } from '../DialogProvider';

interface MergeQueueItem {
  issueId: string;
  title: string;
  branchName: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  conflictsWith: string[];
  batchGroup?: 'batch' | 'serialize';
}

interface UatGenerationMember {
  issueId: string;
  title: string;
  branch: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  acceptanceCriteria: Array<{ title: string; status: string }>;
}

interface UatGenerationPayload {
  name: string;
  status: 'assembling' | 'ready' | 'superseded' | 'invalidated' | 'promoted' | 'failed';
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  members: UatGenerationMember[];
  heldOut: Array<{ issueId: string; reason: string }>;
  resolutions: Array<{ issueIds: string[]; files: string[]; commitSha: string }>;
  stack: { status: 'running' | 'absent'; frontendUrl: string };
}

interface MergeBackendStatus {
  available: boolean;
  mode: 'app' | 'gh-cli' | 'none';
  detail: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(payload.error ?? payload.message ?? `${url} → ${res.status}`);
  return payload;
}

function generationParam(name: string): string {
  return encodeURIComponent(name.replace(/^uat\//, ''));
}

/** Short display name: uat/pan-otter-0610 → pan-otter-0610. */
function shortName(name: string): string {
  return name.replace(/^uat\//, '');
}

export function MergeQueueCard({ active, onNavigateIssue }: { active: boolean; onNavigateIssue?: (issueId: string) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [expandedUat, setExpandedUat] = useState(true);

  const generationsQuery = useQuery({
    queryKey: ['flywheel-uat-generations'],
    queryFn: () => fetchJson<UatGenerationPayload[]>('/api/flywheel/uat-generations'),
    refetchInterval: active ? 15000 : false,
  });
  const mergeQueueQuery = useQuery({
    queryKey: ['flywheel-merge-queue'],
    queryFn: () => fetchJson<MergeQueueItem[]>('/api/flywheel/merge-queue'),
    refetchInterval: active ? 15000 : false,
  });
  const mergeBackendQuery = useQuery({
    queryKey: ['flywheel-merge-backend'],
    queryFn: () => fetchJson<MergeBackendStatus>('/api/flywheel/merge-backend'),
    refetchInterval: active ? 15000 : false,
  });

  const generations = Array.isArray(generationsQuery.data) ? generationsQuery.data : [];
  const mergeQueue = Array.isArray(mergeQueueQuery.data) ? mergeQueueQuery.data : [];
  const mergeBackendUnavailable = mergeBackendQuery.data?.available === false;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['flywheel-uat-generations'] });
    queryClient.invalidateQueries({ queryKey: ['flywheel-merge-queue'] });
  };

  const stackMutation = useMutation({
    mutationFn: (name: string) =>
      postJson<{ frontendUrl: string; evicted: string[] }>(`/api/flywheel/uat-generations/${generationParam(name)}/stack`),
    onSuccess: (data) => {
      if (data.evicted.length > 0) toast.info(`Stopped older UAT stack ${data.evicted.map(shortName).join(', ')} (max 2 run at once)`);
      window.open(data.frontendUrl, '_blank', 'noopener,noreferrer');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start the UAT stack'),
  });

  const promoteMutation = useMutation({
    mutationFn: (name: string) =>
      postJson<{ mergeSha: string; members: string[] }>(`/api/flywheel/uat-generations/${generationParam(name)}/promote`),
    onSuccess: (data) => {
      toast.success(`Merged ${data.members.length} feature${data.members.length === 1 ? '' : 's'} to main (${data.members.join(', ')})`);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Batch merge failed');
      // The most common rejection is a stale card (batch already promoted or
      // invalidated under us — e.g. the post-merge deploy restarted the server
      // before the refetch landed). Refetch so the stale button disappears
      // instead of inviting another doomed click.
      invalidate();
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: () => postJson<{ action: string }>('/api/flywheel/assemble-uat'),
    onSuccess: (data) => {
      if (data.action === 'assembled') toast.success('Rebuilt the UAT batch');
      else toast.info(`Rebuild: ${data.action}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Rebuild failed'),
  });

  const mergeOneMutation = useMutation({
    mutationFn: () => postJson<{ outcomes: Array<{ issueId: string; result: string; reason?: string }> }>('/api/flywheel/merge-next', { n: 1 }),
    onSuccess: (data) => {
      const first = data.outcomes[0];
      if (first?.result === 'merged') toast.success(`Merged ${first.issueId} to main`);
      else toast.warning(`${first?.issueId ?? 'Merge'} did not merge: ${first?.reason ?? 'unknown'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Merge failed'),
  });

  const onPromote = async (gen: UatGenerationPayload) => {
    const lines = gen.members.map((m, i) => `${i + 1}. ${m.issueId} (${m.branch}) — ${m.title}`).join('\n');
    const resolutionNote = gen.resolutions.length > 0
      ? `\n\nIncludes ${gen.resolutions.length} conflict resolution${gen.resolutions.length === 1 ? '' : 's'} you tested (${gen.resolutions.map((r) => r.issueIds.join(' ↔ ')).join('; ')}).`
      : '';
    const ok = await confirm({
      title: `Merge batch ${shortName(gen.name)} to main?`,
      message: `Lands exactly the tree you tested — one merge to main containing:\n${lines}${resolutionNote}\n\nThe ${gen.members.length} issue${gen.members.length === 1 ? '' : 's'} close out through the normal post-merge flow, and remaining ready features reassemble into a fresh batch.`,
      confirmLabel: `Merge batch (${gen.members.length}) to main`,
    });
    if (ok) promoteMutation.mutate(gen.name);
  };

  const onMergeOne = async () => {
    const head = mergeQueue[0];
    if (!head) return;
    const ok = await confirm({
      title: `Merge ${head.issueId} to main on its own?`,
      message: `Merges only ${head.issueId} (${head.branchName}) to main with full checks.\n\nThis bypasses batch testing: the live UAT batches become stale and a new batch reassembles automatically. Prefer merging a tested batch.`,
      confirmLabel: `Merge ${head.issueId} to main`,
      variant: 'destructive',
    });
    if (ok) mergeOneMutation.mutate();
  };

  // Card-visible chain: building + testable batches, newest first (the API
  // already orders newest-first; invalidated/promoted history stays off the rail).
  const visibleGenerations = generations.filter((g) => g.status === 'assembling' || g.status === 'ready' || g.status === 'superseded');
  const currentBatch = visibleGenerations.find((g) => g.status === 'ready') ?? visibleGenerations.find((g) => g.status === 'superseded');
  const featureCount = mergeQueue.length;
  const batchCount = visibleGenerations.filter((g) => g.status !== 'assembling').length;

  const IdLink = ({ issueId }: { issueId: string }) => (
    <button
      type="button"
      onClick={() => onNavigateIssue?.(issueId)}
      className="font-mono text-[11px] font-semibold text-primary hover:underline"
    >
      {issueId}
    </button>
  );

  const ZoneHeader = ({ children }: { children: React.ReactNode }) => (
    <div className="mt-3 mb-1.5 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground after:h-px after:flex-1 after:bg-border">
      {children}
    </div>
  );

  const StackButton = ({ gen, compact }: { gen: UatGenerationPayload; compact?: boolean }) => {
    const starting = stackMutation.isPending && stackMutation.variables === gen.name;
    if (gen.stack.status === 'running') {
      return (
        <a
          href={gen.stack.frontendUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/10"
        >
          ▶ {compact ? 'Open' : 'Open UAT frontend'}
        </a>
      );
    }
    return (
      <button
        type="button"
        disabled={starting}
        onClick={() => stackMutation.mutate(gen.name)}
        title="Starts a live dashboard stack serving this exact batch (~1 min), then opens it"
        className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-60"
      >
        {starting ? (<><Loader2 className="h-3 w-3 animate-spin" /> Starting… ~1 min</>) : (<>▶ {compact ? 'Start & open' : 'Start & open UAT frontend'}</>)}
      </button>
    );
  };

  const empty = visibleGenerations.length === 0 && mergeQueue.length === 0;

  return (
    <RailCard
      icon={<GitMerge className="h-3.5 w-3.5 text-emerald-400" />}
      label="UAT batches"
      ariaLabel="UAT batches"
      count={featureCount > 0 ? `${featureCount} feature${featureCount === 1 ? '' : 's'}${batchCount > 0 ? ` · ${batchCount} batch${batchCount === 1 ? '' : 'es'}` : ''}` : undefined}
    >
      {mergeBackendUnavailable && (
        <div className="mb-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground">Merge backend unavailable</span> — autonomous merge disabled until GitHub App credentials or gh CLI authentication are configured.
        </div>
      )}
      {empty ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">
          No features are ready to merge. When work passes review and tests, it lines up here and a test batch assembles automatically.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="px-1 pb-1 text-[11px] leading-snug text-muted-foreground">
            <span className="font-semibold text-foreground">{featureCount} feature{featureCount === 1 ? '' : 's'}</span> passed review &amp; tests.
            {batchCount > 0
              ? ' They’re assembled into the test batches below — open a batch’s frontend, run its checklist, then merge that batch to main.'
              : ' A test batch assembles automatically when the merge train is on.'}
          </p>

          {visibleGenerations.length > 0 && (
            <>
              <ZoneHeader>Batches — newest first</ZoneHeader>
              {visibleGenerations.map((gen) => {
                if (gen.status === 'assembling') {
                  const done = gen.members.length + gen.heldOut.length;
                  return (
                    <div key={gen.name} className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-violet-400">◌</span>
                        <span className="font-mono text-[11px] font-bold text-violet-400">{shortName(gen.name)}</span>
                        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin text-violet-400" /> assembling…
                        </span>
                      </div>
                      <div className="mt-1 pl-4 text-[10.5px] text-muted-foreground">
                        {done > 0 ? `${gen.members.length} merged${gen.heldOut.length > 0 ? `, ${gen.heldOut.length} held out` : ''} so far. ` : ''}
                        The current batch below stays testable until this one is ready.
                      </div>
                    </div>
                  );
                }
                const isSuperseded = gen.status === 'superseded';
                return (
                  <div
                    key={gen.name}
                    className={`rounded-lg border p-2 ${isSuperseded ? 'border-border opacity-75' : 'border-emerald-500/35 bg-emerald-500/[0.04]'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] ${isSuperseded ? 'text-muted-foreground' : 'text-emerald-400'}`}>{isSuperseded ? '○' : '●'}</span>
                      <span className={`font-mono text-[11px] font-bold ${isSuperseded ? 'text-foreground' : 'text-emerald-400'}`}>{shortName(gen.name)}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{isSuperseded ? 'superseded · still testable' : 'ready to test'}</span>
                    </div>
                    <div className="mt-0.5 pl-4 text-[10.5px] text-muted-foreground">
                      {gen.members.map((m, i) => (
                        <span key={m.issueId}>
                          {i > 0 && ' + '}
                          <IdLink issueId={m.issueId} />
                        </span>
                      ))}
                      {gen.resolutions.length > 0 && (
                        <span> · {gen.resolutions.length} conflict{gen.resolutions.length === 1 ? '' : 's'} resolved in batch</span>
                      )}
                    </div>
                    {gen.heldOut.length > 0 && (
                      <div className="mt-0.5 pl-4 text-[10px] text-amber-400">
                        held out: {gen.heldOut.map((h) => `${h.issueId} (${h.reason})`).join('; ')}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
                      <StackButton gen={gen} compact={isSuperseded} />
                      <button
                        type="button"
                        disabled={promoteMutation.isPending}
                        onClick={() => void onPromote(gen)}
                        className="rounded-md bg-emerald-500 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-950 hover:brightness-110 disabled:opacity-50"
                      >
                        {promoteMutation.isPending && promoteMutation.variables === gen.name ? 'Merging…' : `Merge batch (${gen.members.length}) to main`}
                      </button>
                      {!isSuperseded && (
                        <button
                          type="button"
                          disabled={rebuildMutation.isPending}
                          onClick={() => rebuildMutation.mutate()}
                          title="Re-merge the ready features onto a fresh branch off current main — use if you suspect this batch is stale"
                          className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {rebuildMutation.isPending ? '…' : '↻'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="px-1 text-[9.5px] leading-snug text-muted-foreground">
                Batches build automatically from the ready features. Nothing here merges to main until you say so.
              </p>
            </>
          )}

          {currentBatch && currentBatch.members.length > 0 && (
            <>
              <ZoneHeader>
                <button type="button" className="uppercase tracking-wider hover:text-foreground" onClick={() => setExpandedUat((v) => !v)}>
                  {expandedUat ? '▾' : '▸'} What to UAT — {shortName(currentBatch.name)}
                </button>
              </ZoneHeader>
              {expandedUat && (
                <div className="rounded-lg border border-border p-2">
                  {currentBatch.members.map((member) => {
                    // resolutions[].issueIds[0] is the feature whose merge
                    // conflicted (engine ordering) — the touchpoint item
                    // belongs under that member, once.
                    const touchpoint = currentBatch.resolutions.find((r) => r.issueIds[0] === member.issueId);
                    return (
                      <div key={member.issueId} className="mb-1.5 last:mb-0">
                        <div className="flex items-center gap-1.5 text-[10.5px] font-bold">
                          <IdLink issueId={member.issueId} />
                          <span className="truncate text-foreground">{member.title}</span>
                        </div>
                        <ul className="mt-0.5 space-y-0.5 pl-1">
                          {member.acceptanceCriteria.length === 0 ? (
                            <li className="text-[10.5px] italic text-muted-foreground">No UAT steps in plan — exercise the feature described above.</li>
                          ) : (
                            member.acceptanceCriteria.map((ac, i) => (
                              <li key={i} className="flex gap-1.5 text-[10.5px] leading-snug text-foreground">
                                <span className="text-muted-foreground">☐</span>
                                <span>{ac.title}</span>
                              </li>
                            ))
                          )}
                          {touchpoint && (
                            <li className="flex gap-1.5 text-[10.5px] leading-snug text-amber-300">
                              <span>☐</span>
                              <span>
                                Conflict with {touchpoint.issueIds.filter((id) => id !== member.issueId).join(', ')} was resolved in this batch
                                ({touchpoint.files.join(', ')}) — verify both features still behave at that touchpoint.
                              </span>
                            </li>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {mergeQueue.length > 0 && (
            <>
              <ZoneHeader>Ready features (merge order)</ZoneHeader>
              {mergeQueue.map((item) => {
                const newest = visibleGenerations.find((g) => g.status !== 'assembling');
                const resolved = newest?.resolutions.some((r) => r.issueIds.includes(item.issueId));
                const held = newest?.heldOut.find((h) => h.issueId === item.issueId);
                return (
                  <div key={item.issueId} className="border-t border-border py-1 text-[11.5px] first:border-t-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] font-bold text-muted-foreground">{item.mergeOrder}</span>
                      <IdLink issueId={item.issueId} />
                      <span className="flex-1 truncate text-[11px] text-muted-foreground">{item.title}</span>
                      {resolved && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-400" title="A file overlap with another feature was resolved inside the current batch">
                          ✓ resolved in batch
                        </span>
                      )}
                      {held && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-400" title={held.reason}>
                          ⚠ held out
                        </span>
                      )}
                    </div>
                    <div className="ml-6 mt-0.5 flex items-center gap-2.5">
                      <span className="rounded bg-accent px-1.5 py-px font-mono text-[10px] text-muted-foreground">{item.branchName}</span>
                      {item.prUrl ? (
                        <a href={item.prUrl} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-primary hover:underline">
                          PR {item.pr != null ? `#${item.pr}` : ''} ↗
                        </a>
                      ) : item.pr != null ? (
                        <span className="text-[10px] text-muted-foreground">#{item.pr}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              <div className="mt-1 flex items-center gap-2 border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
                <span>Escape hatch:</span>
                <button
                  type="button"
                  disabled={mergeOneMutation.isPending}
                  onClick={() => void onMergeOne()}
                  className="rounded border border-border px-2 py-0.5 text-[10.5px] text-foreground hover:bg-accent disabled:opacity-50"
                >
                  {mergeOneMutation.isPending ? 'Merging…' : 'Merge one feature to main…'}
                </button>
              </div>
              <p className="px-1 text-[9.5px] leading-snug text-muted-foreground">
                Merging a single feature invalidates the live batches — a fresh batch reassembles automatically. Prefer merging a tested batch.
              </p>
            </>
          )}
        </div>
      )}
    </RailCard>
  );
}
