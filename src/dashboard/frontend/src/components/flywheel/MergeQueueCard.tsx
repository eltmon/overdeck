import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { RailCard } from './RailCard';
import { useConfirm } from '../DialogProvider';

const PROJECT_FILTER_STORAGE_KEY = 'merge-train.projectFilter';

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

interface MergeTrainQueuePayload {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  queue: MergeQueueItem[];
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

interface ProjectUatGenerationsPayload {
  projectKey: string;
  projectName: string;
  generations: UatGenerationPayload[];
}

interface ProjectMergeTrain {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  queue: MergeQueueItem[];
  generations: UatGenerationPayload[];
}

type ReconcileResultMap = Record<string, { action: string; invalidated: string[] }>;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(payload.error ?? payload.message ?? `${url} -> ${res.status}`);
  return payload;
}

function generationParam(name: string): string {
  return encodeURIComponent(name.replace(/^uat\//, ''));
}

function shortName(name: string): string {
  return name.replace(/^uat\//, '');
}

function readStoredProjectFilter(): string {
  try {
    return localStorage.getItem(PROJECT_FILTER_STORAGE_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

function persistProjectFilter(value: string): void {
  try {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, value);
  } catch {
    // Persistence is best-effort; rendering should never depend on storage.
  }
}

function actionsForProject(data: ReconcileResultMap, projectKey: string): string[] {
  const action = data[projectKey]?.action;
  return action ? [action] : Object.values(data).map((result) => result.action);
}

function mergeProjects(queues: MergeTrainQueuePayload[] | undefined, generations: ProjectUatGenerationsPayload[] | undefined): ProjectMergeTrain[] {
  const byKey = new Map<string, ProjectMergeTrain>();
  for (const project of Array.isArray(queues) ? queues : []) {
    byKey.set(project.projectKey, {
      projectKey: project.projectKey,
      projectName: project.projectName,
      enabled: project.enabled,
      queue: project.queue ?? [],
      generations: [],
    });
  }
  for (const project of Array.isArray(generations) ? generations : []) {
    const existing = byKey.get(project.projectKey);
    byKey.set(project.projectKey, {
      projectKey: project.projectKey,
      projectName: project.projectName,
      enabled: existing?.enabled ?? false,
      queue: existing?.queue ?? [],
      generations: project.generations ?? [],
    });
  }
  return [...byKey.values()];
}

export function MergeQueueCard({ active, onNavigateIssue }: { active: boolean; onNavigateIssue?: (issueId: string) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [expandedUat, setExpandedUat] = useState<Record<string, boolean>>({});
  const [projectFilter, setProjectFilter] = useState(readStoredProjectFilter);

  const generationsQuery = useQuery({
    queryKey: ['merge-train-generations'],
    queryFn: () => fetchJson<ProjectUatGenerationsPayload[]>('/api/merge-train/generations'),
    refetchInterval: active ? 15000 : false,
  });
  const queuesQuery = useQuery({
    queryKey: ['merge-train-queues'],
    queryFn: () => fetchJson<MergeTrainQueuePayload[]>('/api/merge-train/queues'),
    refetchInterval: active ? 15000 : false,
  });

  const projects = useMemo(() => mergeProjects(queuesQuery.data, generationsQuery.data), [queuesQuery.data, generationsQuery.data]);
  const effectiveFilter = projectFilter === 'all' || projects.some((project) => project.projectKey === projectFilter) ? projectFilter : 'all';
  const visibleProjects = effectiveFilter === 'all' ? projects : projects.filter((project) => project.projectKey === effectiveFilter);
  const totalFeatures = projects.reduce((sum, project) => sum + project.queue.length, 0);
  const totalBatches = projects.reduce(
    (sum, project) => sum + project.generations.filter((gen) => gen.status === 'ready' || gen.status === 'superseded').length,
    0,
  );

  const setFilter = (value: string) => {
    setProjectFilter(value);
    persistProjectFilter(value);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['merge-train-generations'] });
    queryClient.invalidateQueries({ queryKey: ['merge-train-queues'] });
  };

  const stackMutation = useMutation({
    mutationFn: (gen: UatGenerationPayload) =>
      postJson<{ frontendUrl: string; evicted: string[] }>(`/api/merge-train/generations/${generationParam(gen.name)}/stack`),
    onSuccess: (data) => {
      if (data.evicted.length > 0) toast.info(`Stopped older UAT stack ${data.evicted.map(shortName).join(', ')} (max 2 run at once)`);
      window.open(data.frontendUrl, '_blank', 'noopener,noreferrer');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start the UAT stack'),
  });

  const promoteMutation = useMutation({
    mutationFn: (gen: UatGenerationPayload) =>
      postJson<{ mergeSha: string; members: string[] }>(`/api/merge-train/generations/${generationParam(gen.name)}/promote`),
    onSuccess: (data) => {
      toast.success(`Merged ${data.members.length} feature${data.members.length === 1 ? '' : 's'} to main (${data.members.join(', ')})`);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Batch merge failed');
      invalidate();
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: (project: ProjectMergeTrain) => postJson<ReconcileResultMap>('/api/merge-train/assemble', { project: project.projectKey }),
    onSuccess: (data, project) => {
      const actions = actionsForProject(data, project.projectKey);
      if (actions.includes('assembled')) toast.success(`Rebuilt ${project.projectName} UAT batch`);
      else toast.info(`Rebuild ${project.projectName}: ${[...new Set(actions)].join(', ') || 'idle'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Rebuild failed'),
  });

  const mergeOneMutation = useMutation({
    mutationFn: (project: ProjectMergeTrain) =>
      postJson<{ outcomes: Array<{ issueId: string; result: string; reason?: string }> }>('/api/merge-train/merge-next', { n: 1, project: project.projectKey }),
    onSuccess: (data) => {
      const first = data.outcomes[0];
      if (first?.result === 'merged') toast.success(`Merged ${first.issueId} to main`);
      else toast.warning(`${first?.issueId ?? 'Merge'} did not merge: ${first?.reason ?? 'unknown'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Merge failed'),
  });

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

  const onStack = async (project: ProjectMergeTrain, gen: UatGenerationPayload) => {
    const ok = await confirm({
      title: `Open UAT frontend for ${shortName(gen.name)}?`,
      message: `Starts a live frontend for ${project.projectName} containing:\n${gen.members.map((m, i) => `${i + 1}. ${m.issueId} (${m.branch}) - ${m.title}`).join('\n')}`,
      confirmLabel: 'Start & open UAT frontend',
    });
    if (ok) stackMutation.mutate(gen);
  };

  const onPromote = async (project: ProjectMergeTrain, gen: UatGenerationPayload) => {
    const lines = gen.members.map((m, i) => `${i + 1}. ${m.issueId} (${m.branch}) - ${m.title}`).join('\n');
    const resolutionNote = gen.resolutions.length > 0
      ? `\n\nIncludes ${gen.resolutions.length} conflict resolution${gen.resolutions.length === 1 ? '' : 's'} you tested (${gen.resolutions.map((r) => r.issueIds.join(' / ')).join('; ')}).`
      : '';
    const ok = await confirm({
      title: `Merge ${project.projectName} batch ${shortName(gen.name)} to main?`,
      message: `Lands exactly the tree you tested - one merge to main containing:\n${lines}${resolutionNote}\n\nThe ${gen.members.length} issue${gen.members.length === 1 ? '' : 's'} close out through the normal post-merge flow, and remaining ready features reassemble into a fresh batch.`,
      confirmLabel: `Merge batch (${gen.members.length}) to main`,
    });
    if (ok) promoteMutation.mutate(gen);
  };

  const onRebuild = async (project: ProjectMergeTrain) => {
    const issues = project.queue.map((item, i) => `${i + 1}. ${item.issueId} (${item.branchName}) - ${item.title}`).join('\n') || 'No ready features.';
    const ok = await confirm({
      title: `Rebuild ${project.projectName} UAT batch?`,
      message: `Re-merges this project's ready features onto a fresh branch off current main:\n${issues}`,
      confirmLabel: 'Rebuild UAT batch',
    });
    if (ok) rebuildMutation.mutate(project);
  };

  const onMergeOne = async (project: ProjectMergeTrain) => {
    const head = project.queue[0];
    if (!head) return;
    const ok = await confirm({
      title: `Merge ${head.issueId} to main on its own?`,
      message: `Merges only ${head.issueId} (${head.branchName}) from ${project.projectName} to main with full checks.\n\nThis bypasses batch testing: the live UAT batches become stale and a new batch reassembles automatically. Prefer merging a tested batch.`,
      confirmLabel: `Merge ${head.issueId} to main`,
      variant: 'destructive',
    });
    if (ok) mergeOneMutation.mutate(project);
  };

  const renderStackButton = (project: ProjectMergeTrain, gen: UatGenerationPayload, compact?: boolean) => {
    const starting = stackMutation.isPending && stackMutation.variables?.name === gen.name;
    if (gen.stack.status === 'running') {
      return (
        <a
          href={gen.stack.frontendUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/10"
        >
          Open{compact ? '' : ' UAT frontend'}
        </a>
      );
    }
    return (
      <button
        type="button"
        disabled={starting}
        onClick={() => void onStack(project, gen)}
        title="Starts a live dashboard stack serving this exact batch, then opens it"
        className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-60"
      >
        {starting ? (<><Loader2 className="h-3 w-3 animate-spin" /> Starting...</>) : (compact ? 'Start & open' : 'Start & open UAT frontend')}
      </button>
    );
  };

  const renderProject = (project: ProjectMergeTrain) => {
    const visibleGenerations = project.generations.filter((g) => g.status === 'assembling' || g.status === 'ready' || g.status === 'superseded');
    const currentBatch = visibleGenerations.find((g) => g.status === 'ready') ?? visibleGenerations.find((g) => g.status === 'superseded');
    const expanded = expandedUat[project.projectKey] ?? true;
    const projectEmpty = visibleGenerations.length === 0 && project.queue.length === 0;

    return (
      <section key={project.projectKey} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{project.projectName}</h3>
          <span className="text-[10.5px] text-muted-foreground">{project.enabled ? 'merge train enabled' : 'merge train disabled'}</span>
          <span className="ml-auto text-[10.5px] text-muted-foreground">
            {project.queue.length} ready · {visibleGenerations.filter((g) => g.status !== 'assembling').length} batches
          </span>
        </div>

        {projectEmpty ? (
          <p className="px-1 py-1.5 text-xs text-muted-foreground">
            No features are ready to merge for this project.
          </p>
        ) : (
          <div className="space-y-1">
            {visibleGenerations.length > 0 && (
              <>
                <ZoneHeader>Batches - newest first</ZoneHeader>
                {visibleGenerations.map((gen) => {
                  if (gen.status === 'assembling') {
                    return (
                      <div key={gen.name} className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-violet-400">o</span>
                          <span className="font-mono text-[11px] font-bold text-violet-400">{shortName(gen.name)}</span>
                          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin text-violet-400" /> assembling...
                          </span>
                        </div>
                        <div className="mt-1 pl-4 text-[10.5px] text-muted-foreground">
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
                        <span className={`text-[10px] ${isSuperseded ? 'text-muted-foreground' : 'text-emerald-400'}`}>{isSuperseded ? 'o' : '*'}</span>
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
                        <div className="mt-1 flex flex-wrap gap-1 pl-4 text-[10px] text-amber-400">
                          {gen.heldOut.map((held) => (
                            <span key={held.issueId} className="rounded border border-amber-500/30 px-1.5 py-0.5">
                              held out: {held.issueId} ({held.reason})
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
                        {renderStackButton(project, gen, isSuperseded)}
                        <button
                          type="button"
                          disabled={promoteMutation.isPending}
                          onClick={() => void onPromote(project, gen)}
                          className="rounded-md bg-emerald-500 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-950 hover:brightness-110 disabled:opacity-50"
                        >
                          {promoteMutation.isPending && promoteMutation.variables?.name === gen.name ? 'Merging...' : `Merge batch (${gen.members.length}) to main`}
                        </button>
                        {!isSuperseded && (
                          <button
                            type="button"
                            disabled={rebuildMutation.isPending}
                            onClick={() => void onRebuild(project)}
                            title="Re-merge the ready features onto a fresh branch off current main"
                            className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                          >
                            {rebuildMutation.isPending && rebuildMutation.variables?.projectKey === project.projectKey ? '...' : 'Rebuild'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {currentBatch && currentBatch.members.length > 0 && (
              <>
                <ZoneHeader>
                  <button
                    type="button"
                    className="uppercase tracking-wider hover:text-foreground"
                    onClick={() => setExpandedUat((state) => ({ ...state, [project.projectKey]: !expanded }))}
                  >
                    {expanded ? 'v' : '>'} What to UAT - {shortName(currentBatch.name)}
                  </button>
                </ZoneHeader>
                {expanded && (
                  <div className="rounded-lg border border-border p-2">
                    {currentBatch.members.map((member) => {
                      const touchpoint = currentBatch.resolutions.find((r) => r.issueIds[0] === member.issueId);
                      return (
                        <div key={member.issueId} className="mb-1.5 last:mb-0">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-bold">
                            <IdLink issueId={member.issueId} />
                            <span className="truncate text-foreground">{member.title}</span>
                          </div>
                          <ul className="mt-0.5 space-y-0.5 pl-1">
                            {member.acceptanceCriteria.length === 0 ? (
                              <li className="text-[10.5px] italic text-muted-foreground">No UAT steps in plan - exercise the feature described above.</li>
                            ) : (
                              member.acceptanceCriteria.map((ac, i) => (
                                <li key={i} className="flex gap-1.5 text-[10.5px] leading-snug text-foreground">
                                  <span className="text-muted-foreground">[ ]</span>
                                  <span>{ac.title}</span>
                                </li>
                              ))
                            )}
                            {touchpoint && (
                              <li className="flex gap-1.5 text-[10.5px] leading-snug text-amber-300">
                                <span>[ ]</span>
                                <span>
                                  Conflict with {touchpoint.issueIds.filter((id) => id !== member.issueId).join(', ')} was resolved in this batch
                                  ({touchpoint.files.join(', ')}) - verify both features still behave at that touchpoint.
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

            {project.queue.length > 0 && (
              <>
                <ZoneHeader>Ready features (merge order)</ZoneHeader>
                {project.queue.map((item) => {
                  const newest = visibleGenerations.find((g) => g.status !== 'assembling');
                  const resolved = newest?.resolutions.some((r) => r.issueIds.includes(item.issueId));
                  const held = newest?.heldOut.find((h) => h.issueId === item.issueId);
                  return (
                    <div key={item.issueId} className="border-t border-border py-1 text-[11.5px] first:border-t-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] font-bold text-muted-foreground">{item.mergeOrder}</span>
                        <IdLink issueId={item.issueId} />
                        <span className="flex-1 truncate text-[11px] text-muted-foreground">{item.title}</span>
                        {resolved && <span className="text-[9.5px] font-bold text-emerald-400">resolved in batch</span>}
                        {held && <span className="text-[9.5px] font-bold text-amber-400" title={held.reason}>held out</span>}
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
                    onClick={() => void onMergeOne(project)}
                    className="rounded border border-border px-2 py-0.5 text-[10.5px] text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {mergeOneMutation.isPending && mergeOneMutation.variables?.projectKey === project.projectKey ? 'Merging...' : 'Merge one feature to main...'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    );
  };

  const empty = projects.length === 0 || projects.every((project) => project.generations.length === 0 && project.queue.length === 0);

  return (
    <RailCard
      icon={<GitMerge className="h-3.5 w-3.5 text-emerald-400" />}
      label="UAT batches"
      ariaLabel="UAT batches"
      count={totalFeatures > 0 ? `${totalFeatures} feature${totalFeatures === 1 ? '' : 's'}${totalBatches > 0 ? ` · ${totalBatches} batch${totalBatches === 1 ? '' : 'es'}` : ''}` : undefined}
    >
      {projects.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded border px-2 py-0.5 text-[10.5px] ${effectiveFilter === 'all' ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            All projects
          </button>
          {projects.map((project) => (
            <button
              key={project.projectKey}
              type="button"
              onClick={() => setFilter(effectiveFilter === project.projectKey ? 'all' : project.projectKey)}
              className={`rounded border px-2 py-0.5 text-[10.5px] ${effectiveFilter === project.projectKey ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {project.projectName}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">
          No features are ready to merge. When work passes review and tests, it lines up here and a test batch assembles automatically.
        </p>
      ) : visibleProjects.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">No projects match the current filter.</p>
      ) : (
        <div className="space-y-4">
          {visibleProjects.map(renderProject)}
        </div>
      )}
    </RailCard>
  );
}
