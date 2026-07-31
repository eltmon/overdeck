/**
 * Multi-project merge-train view (PAN-1696 fe-merge-train-view).
 *
 * This is the shared body of the merge-train surface. It replaces the
 * single-project card that read `/api/flywheel/uat-generations` and
 * `/api/flywheel/merge-queue`: those answered for the dashboard's own repo
 * only, and only while a flywheel run was active. This view reads the
 * aggregate `/api/merge-train/*` namespace instead, so a ready feature in ANY
 * tracked project shows up whether or not a flywheel run exists.
 *
 * Layout per project section — unchanged in substance from the old card:
 * plain-language intro · batches newest-first (ready / assembling /
 * superseded, with live frontend + promote actions) · per-member "What to UAT"
 * checklist · ready-features reference rows (branch + PR) · a single-feature
 * escape hatch. Project filter chips sit above the sections and persist.
 *
 * Honest-language contract: every action names its exact effect and confirms
 * via useConfirm() before anything fires. Merging a batch lands exactly the
 * tree the operator tested.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { useConfirm } from '../DialogProvider';

/** localStorage key holding the operator's project-filter selection. */
export const MERGE_TRAIN_PROJECT_FILTER_KEY = 'merge-train.projectFilter';

export interface MergeTrainQueueItem {
  issueId: string;
  title: string;
  branchName: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  conflictsWith: string[];
  batchGroup?: 'batch' | 'serialize';
}

export interface UatGenerationMember {
  issueId: string;
  title: string;
  branch: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  acceptanceCriteria: Array<{ title: string; status: string }>;
  /**
   * PAN-3165: false when the server could not resolve the issue's xBRIEF at
   * all. Optional so an older cached payload degrades to the unresolved
   * message rather than asserting the plan listed nothing.
   */
  planResolved?: boolean;
}

export interface UatGenerationPayload {
  name: string;
  status: 'assembling' | 'ready' | 'superseded' | 'invalidated' | 'promoted' | 'failed';
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  members: UatGenerationMember[];
  heldOut: Array<{ issueId: string; reason: string }>;
  resolutions: Array<{ issueIds: string[]; files: string[]; commitSha: string }>;
  versionSyncConfigured?: boolean;
  shipStatus?: {
    status: 'pending' | 'passed' | 'partial' | 'failed';
    version?: string;
    batch: string;
    error?: string;
    reason?: string;
    at: string;
  } | null;
  stack: {
    status: 'running' | 'degraded' | 'unknown' | 'absent';
    frontendUrl: string;
    /** Declared services that are not serving — `degraded` only (PAN-3166). */
    downServices?: string[];
    /** service → last error line from its logs. */
    serviceErrors?: Record<string, string>;
    /** Why the probe could not tell — `unknown` only. */
    probeError?: string;
  };
}

interface QueuesEntry {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  queue: MergeTrainQueueItem[];
}

interface GenerationsEntry {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  generations: UatGenerationPayload[];
}

interface MergeBackendStatus {
  available: boolean;
  mode: 'app' | 'gh-cli' | 'none';
  detail: string;
}

/** One project's merged view: its queue, its generations, and its flag. */
export interface MergeTrainProjectSection {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  queue: MergeTrainQueueItem[];
  generations: UatGenerationPayload[];
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
export function shortName(name: string): string {
  return name.replace(/^uat\//, '');
}

/**
 * Join the two aggregate payloads into one section per project. Exported so the
 * merge logic is unit-testable without rendering, and so a host that already
 * holds the payloads can reuse it.
 */
export function mergeTrainSections(
  queues: QueuesEntry[],
  generations: GenerationsEntry[],
): MergeTrainProjectSection[] {
  const generationsByProject = new Map(generations.map((g) => [g.projectKey, g]));
  const sections: MergeTrainProjectSection[] = queues.map((q) => ({
    projectKey: q.projectKey,
    projectName: q.projectName,
    enabled: q.enabled,
    queue: Array.isArray(q.queue) ? q.queue : [],
    generations: generationsByProject.get(q.projectKey)?.generations ?? [],
  }));
  // A project can have generations without a queues row only if the two reads
  // raced a project-registry change; keep it rather than dropping its batches.
  for (const g of generations) {
    if (sections.some((s) => s.projectKey === g.projectKey)) continue;
    sections.push({
      projectKey: g.projectKey,
      projectName: g.projectName,
      enabled: g.enabled,
      queue: [],
      generations: Array.isArray(g.generations) ? g.generations : [],
    });
  }
  return sections;
}

/** Batches the surface shows: building + testable, plus promoted batches awaiting version ship. */
function visibleGenerationsOf(section: MergeTrainProjectSection): UatGenerationPayload[] {
  return section.generations.filter(
    (g) => g.status === 'assembling'
      || g.status === 'ready'
      || g.status === 'superseded'
      || (g.status === 'promoted' && g.versionSyncConfigured === true && g.shipStatus?.status === 'pending'),
  );
}

function isIdleSection(section: MergeTrainProjectSection): boolean {
  return section.queue.length === 0 && visibleGenerationsOf(section).length === 0;
}

function readStoredFilter(): string[] | null {
  try {
    const raw = window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

function writeStoredFilter(keys: string[] | null): void {
  try {
    if (keys === null) window.localStorage.removeItem(MERGE_TRAIN_PROJECT_FILTER_KEY);
    else window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(keys));
  } catch {
    // A blocked localStorage costs the operator persistence, not the view.
  }
}

/**
 * The view's data reads, shared so a host can label itself (e.g. the Flywheel
 * rail card's count) from the same payloads the sections render. React Query
 * dedupes by key, so calling this alongside <MergeTrainView> costs no extra
 * requests. `active` only controls polling — the reads happen either way, which
 * is what lets the Flywheel rail render with no run in progress.
 */
export function useMergeTrainData(active: boolean) {
  const queuesQuery = useQuery({
    queryKey: ['merge-train-queues'],
    queryFn: () => fetchJson<QueuesEntry[]>('/api/merge-train/queues'),
    refetchInterval: active ? 15000 : false,
  });
  const generationsQuery = useQuery({
    queryKey: ['merge-train-generations'],
    queryFn: () => fetchJson<GenerationsEntry[]>('/api/merge-train/generations'),
    refetchInterval: active ? 15000 : false,
  });
  const sections = mergeTrainSections(
    Array.isArray(queuesQuery.data) ? queuesQuery.data : [],
    Array.isArray(generationsQuery.data) ? generationsQuery.data : [],
  );

  return { sections, isLoading: queuesQuery.isLoading || generationsQuery.isLoading };
}

/**
 * Capability probe, not flywheel run state: whether a GitHub App or gh CLI can
 * merge at all. Deliberately NOT part of useMergeTrainData — only the full view
 * renders the warning, so a host that just wants counts (the Flywheel rail card,
 * the cockpit summary) should not pay for this request.
 */
export function useMergeBackendStatus(active: boolean): { unavailable: boolean } {
  const query = useQuery({
    queryKey: ['merge-train-merge-backend'],
    queryFn: () => fetchJson<MergeBackendStatus>('/api/flywheel/merge-backend'),
    refetchInterval: active ? 15000 : false,
  });
  return { unavailable: query.data?.available === false };
}

/** Totals across every project, for a host that shows one summary count. */
export function mergeTrainTotals(sections: MergeTrainProjectSection[]): { features: number; batches: number } {
  let features = 0;
  let batches = 0;
  for (const section of sections) {
    features += section.queue.length;
    batches += visibleGenerationsOf(section).filter((g) => g.status !== 'assembling').length;
  }
  return { features, batches };
}

const ZoneHeader = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-3 mb-1.5 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground after:h-px after:flex-1 after:bg-border">
    {children}
  </div>
);

export interface MergeTrainViewProps {
  /** Poll while the surface is on screen; false stops the refetch interval. */
  active: boolean;
  onNavigateIssue?: (issueId: string) => void;
  /** Hide the project filter chips when the host renders a single project. */
  showProjectFilter?: boolean;
}

export function MergeTrainView({ active, onNavigateIssue, showProjectFilter = true }: MergeTrainViewProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [expandedUat, setExpandedUat] = useState<Record<string, boolean>>({});
  const [versionAction, setVersionAction] = useState<{
    generationName: string;
    mode: 'promote' | 'ship';
    version: string;
    error?: string;
  } | null>(null);
  // null = "all projects", the default. A stored array selects a subset.
  const [selectedProjects, setSelectedProjects] = useState<string[] | null>(() => readStoredFilter());

  const { sections, isLoading: loading } = useMergeTrainData(active);
  const { unavailable: mergeBackendUnavailable } = useMergeBackendStatus(active);

  // Drop filter entries for projects that no longer exist, so a renamed or
  // removed project cannot leave the view permanently empty.
  useEffect(() => {
    if (selectedProjects === null || sections.length === 0) return;
    const known = new Set(sections.map((s) => s.projectKey));
    const pruned = selectedProjects.filter((k) => known.has(k));
    if (pruned.length === selectedProjects.length) return;
    const next = pruned.length === 0 ? null : pruned;
    setSelectedProjects(next);
    writeStoredFilter(next);
  }, [sections, selectedProjects]);

  const isSelected = (projectKey: string) => selectedProjects === null || selectedProjects.includes(projectKey);
  const visibleSections = sections.filter((s) => isSelected(s.projectKey));
  // Idle enabled sections repeat boilerplate without adding information. Disabled
  // sections are never hidden because "merge train off" is meaningful state.
  const renderedSections = visibleSections.filter((section) => !section.enabled || !isIdleSection(section));
  const idleHiddenCount = visibleSections.length - renderedSections.length;

  const toggleProject = (projectKey: string) => {
    const current = selectedProjects ?? sections.map((s) => s.projectKey);
    const next = current.includes(projectKey)
      ? current.filter((k) => k !== projectKey)
      : [...current, projectKey];
    // Deselecting everything reads as "show nothing useful", so fall back to all.
    const resolved = next.length === 0 || next.length === sections.length ? null : next;
    setSelectedProjects(resolved);
    writeStoredFilter(resolved);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['merge-train-queues'] });
    queryClient.invalidateQueries({ queryKey: ['merge-train-generations'] });
  };

  const stackMutation = useMutation({
    mutationFn: (name: string) =>
      postJson<{ frontendUrl: string; evicted: string[] }>(`/api/merge-train/generations/${generationParam(name)}/stack`),
    onSuccess: (data) => {
      if (data.evicted.length > 0) toast.info(`Stopped older UAT stack ${data.evicted.map(shortName).join(', ')} (max 2 run at once)`);
      window.open(data.frontendUrl, '_blank', 'noopener,noreferrer');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start the UAT stack'),
  });

  const promoteMutation = useMutation({
    mutationFn: ({ name, shipVersion }: { name: string; shipVersion?: string }) =>
      postJson<{ mergeSha: string; members: string[] }>(
        `/api/merge-train/generations/${generationParam(name)}/promote`,
        shipVersion ? { shipVersion } : undefined,
      ),
    onSuccess: (data) => {
      setVersionAction(null);
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

  const shipMutation = useMutation({
    mutationFn: ({ name, version }: { name: string; version: string }) =>
      postJson<{ status: 'passed' | 'partial' | 'failed'; error?: string }>(
        `/api/merge-train/generations/${generationParam(name)}/ship`,
        { version },
      ),
    onSuccess: (data) => {
      setVersionAction(null);
      if (data.status === 'passed') toast.success('Version strings shipped');
      else toast.warning(data.error ?? `Version ship finished with status ${data.status}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Version ship failed'),
  });

  const rebuildMutation = useMutation({
    mutationFn: (projectKey: string) =>
      postJson<{ projects: Array<{ projectKey: string; result?: { action: string }; error?: string }> }>(
        '/api/merge-train/assemble',
        { project: projectKey },
      ),
    onSuccess: (data) => {
      const action = data.projects[0]?.result?.action;
      if (action === 'assembled') toast.success('Rebuilt the UAT batch');
      else toast.info(`Rebuild: ${action ?? data.projects[0]?.error ?? 'no change'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Rebuild failed'),
  });

  const mergeOneMutation = useMutation({
    mutationFn: (projectKey: string) =>
      postJson<{ outcomes: Array<{ issueId: string; result: string; reason?: string }> }>(
        '/api/merge-train/merge-next',
        { n: 1, project: projectKey },
      ),
    onSuccess: (data) => {
      const first = data.outcomes[0];
      if (first?.result === 'merged') toast.success(`Merged ${first.issueId} to main`);
      else toast.warning(`${first?.issueId ?? 'Merge'} did not merge: ${first?.reason ?? 'unknown'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Merge failed'),
  });

  const confirmPromote = async (gen: UatGenerationPayload, shipVersion?: string) => {
    const lines = gen.members.map((m, i) => `${i + 1}. ${m.issueId} (${m.branch}) — ${m.title}`).join('\n');
    const resolutionNote = gen.resolutions.length > 0
      ? `\n\nIncludes ${gen.resolutions.length} conflict resolution${gen.resolutions.length === 1 ? '' : 's'} you tested (${gen.resolutions.map((r) => r.issueIds.join(' ↔ ')).join('; ')}).`
      : '';
    const shipNote = gen.versionSyncConfigured
      ? shipVersion
        ? `\n\nVersion ${shipVersion} will be propagated after the merge lands.`
        : '\n\nNo version supplied — the batch merges without a version bump and each member\'s ship row will fail until you ship one.'
      : '';
    const ok = await confirm({
      title: `Merge batch ${shortName(gen.name)} to main?`,
      message: `Lands exactly the tree you tested — one merge to main containing:\n${lines}${resolutionNote}${shipNote}\n\nThe ${gen.members.length} issue${gen.members.length === 1 ? '' : 's'} close out through the normal post-merge flow, and remaining ready features reassemble into a fresh batch.`,
      confirmLabel: `Merge batch (${gen.members.length}) to main`,
    });
    if (ok) promoteMutation.mutate({ name: gen.name, ...(shipVersion ? { shipVersion } : {}) });
  };

  const onPromote = async (gen: UatGenerationPayload) => {
    if (gen.versionSyncConfigured) {
      setVersionAction({ generationName: gen.name, mode: 'promote', version: '' });
      return;
    }
    await confirmPromote(gen);
  };

  const submitVersionAction = async (gen: UatGenerationPayload) => {
    if (!versionAction || versionAction.generationName !== gen.name) return;
    const version = versionAction.version.trim();
    if ((versionAction.mode === 'ship' || version !== '') && !/^\d+\.\d+\.\d+$/.test(version)) {
      setVersionAction({ ...versionAction, error: 'version must look like 48.8.0' });
      return;
    }
    if (versionAction.mode === 'promote') {
      await confirmPromote(gen, version || undefined);
      return;
    }
    const ok = await confirm({
      title: `Ship version ${version} for ${shortName(gen.name)}?`,
      message: `Runs this project's configured version-string propagation for ${version}, verifies every declared target, commits only declared paths, and pushes the configured repositories. This does not publish packages, deploy, tag, or submit an app store build.`,
      confirmLabel: `Ship version ${version}`,
    });
    if (ok) shipMutation.mutate({ name: gen.name, version });
  };

  const onStack = async (gen: UatGenerationPayload) => {
    const ok = await confirm({
      title: `Start a live UAT stack for ${shortName(gen.name)}?`,
      message: `Builds and runs a dashboard stack serving this exact batch (${gen.members.map((m) => m.issueId).join(', ')}) — about a minute — then opens it.\n\nAt most two UAT stacks run at once, so starting this one may stop the oldest running stack.`,
      confirmLabel: 'Start & open',
    });
    if (ok) stackMutation.mutate(gen.name);
  };

  const onRebuild = async (section: MergeTrainProjectSection, gen: UatGenerationPayload) => {
    const discarded = gen.members.map((m, i) => `${i + 1}. ${m.issueId} (${m.branch}) — ${m.title}`).join('\n');
    const resolutionNote = gen.resolutions.length > 0
      ? `\n\nThe ${gen.resolutions.length} conflict resolution${gen.resolutions.length === 1 ? '' : 's'} in this batch (${gen.resolutions.map((r) => r.issueIds.join(' ↔ ')).join('; ')}) will be redone from scratch.`
      : '';
    const ok = await confirm({
      title: `Rebuild ${shortName(gen.name)} from current main?`,
      message: `Discards this batch and re-merges ${section.projectName}'s ready features onto a fresh branch off current main. The batch being discarded contains:\n${discarded}${resolutionNote}\n\nThis runs git operations in ${section.projectName}, and any UAT you already did against ${shortName(gen.name)} no longer applies.`,
      confirmLabel: 'Rebuild batch',
    });
    if (ok) rebuildMutation.mutate(section.projectKey);
  };

  const onMergeOne = async (section: MergeTrainProjectSection) => {
    const head = section.queue[0];
    if (!head) return;
    const ok = await confirm({
      title: `Merge ${head.issueId} to main on its own?`,
      message: `Merges only ${head.issueId} (${head.branchName}) to main with full checks in ${section.projectName}.\n\nThis bypasses batch testing: the live UAT batches become stale and a new batch reassembles automatically. Prefer merging a tested batch.`,
      confirmLabel: `Merge ${head.issueId} to main`,
      variant: 'destructive',
    });
    if (ok) mergeOneMutation.mutate(section.projectKey);
  };

  const IdLink = ({ issueId }: { issueId: string }) => (
    <button
      type="button"
      onClick={() => onNavigateIssue?.(issueId)}
      className="font-mono text-[11px] font-semibold text-primary hover:underline"
    >
      {issueId}
    </button>
  );

  const StackButton = ({ gen, compact }: { gen: UatGenerationPayload; compact?: boolean }) => {
    const starting = stackMutation.isPending && stackMutation.variables === gen.name;
    // PAN-3166: a stack whose api died still has healthy containers. Offering
    // "Open UAT frontend" there sends the operator into a gateway timeout, so a
    // degraded stack gets a restart control instead of a link.
    if (gen.stack.status === 'degraded' || gen.stack.status === 'unknown') {
      const unknown = gen.stack.status === 'unknown';
      const down = gen.stack.downServices ?? [];
      const detail = Object.entries(gen.stack.serviceErrors ?? {})
        .map(([service, line]) => `${service}: ${line}`)
        .join('\n');
      return (
        <button
          type="button"
          disabled={starting}
          onClick={() => void onStack(gen)}
          data-testid={`uat-stack-degraded-${gen.name}`}
          title={
            unknown
              ? `Could not probe the stack: ${gen.stack.probeError ?? 'unknown error'} — the stack record is preserved`
              : detail || `Not serving: ${down.join(', ') || 'a declared service'} — restart the stack`
          }
          className="inline-flex items-center gap-1 rounded border border-amber-500/50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400 hover:bg-amber-500/10 disabled:opacity-60"
        >
          {starting
            ? (<><Loader2 className="h-3 w-3 animate-spin" /> Restarting…</>)
            : unknown
              ? (<>⚠ {compact ? 'Unknown' : 'Stack state unknown'}</>)
              : (<>⚠ {compact ? 'Degraded' : `Stack degraded — ${down.join(', ') || 'service down'}`}</>)}
        </button>
      );
    }
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
        onClick={() => void onStack(gen)}
        title="Starts a live dashboard stack serving this exact batch (~1 min), then opens it"
        className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-60"
      >
        {starting ? (<><Loader2 className="h-3 w-3 animate-spin" /> Starting… ~1 min</>) : (<>▶ {compact ? 'Start & open' : 'Start & open UAT frontend'}</>)}
      </button>
    );
  };

  return (
    <div data-testid="merge-train-view">
      {mergeBackendUnavailable && (
        <div className="mb-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground">Merge backend unavailable</span> — autonomous merge disabled until GitHub App credentials or gh CLI authentication are configured.
        </div>
      )}

      {showProjectFilter && sections.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="merge-train-project-filter">
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Projects</span>
          {sections.map((section) => {
            const on = isSelected(section.projectKey);
            return (
              <button
                key={section.projectKey}
                type="button"
                aria-pressed={on}
                onClick={() => toggleProject(section.projectKey)}
                className={`rounded border px-1.5 py-0.5 text-[10.5px] ${
                  on ? 'border-border bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                {section.projectName}
              </button>
            );
          })}
          {selectedProjects !== null && (
            <button
              type="button"
              onClick={() => { setSelectedProjects(null); writeStoredFilter(null); }}
              className="text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              show all
            </button>
          )}
        </div>
      )}

      {sections.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">
          {loading
            ? 'Loading the merge train…'
            : 'No projects are registered, so there is no merge train to show.'}
        </p>
      ) : visibleSections.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">
          Every project is filtered out. Select a project above to see its merge train.
        </p>
      ) : renderedSections.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-muted-foreground">
          {loading
            ? 'Loading the merge train…'
            : visibleSections.length === sections.length
              ? 'No features are ready to merge in any project. When work passes review and tests, it lines up here and a test batch assembles automatically.'
              : 'No features are ready to merge in the selected projects. Other projects may still have ready work.'}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {renderedSections.map((section) => {
            const visibleGenerations = visibleGenerationsOf(section);
            const currentBatch =
              visibleGenerations.find((g) => g.status === 'ready') ??
              visibleGenerations.find((g) => g.status === 'superseded');
            const featureCount = section.queue.length;
            const batchCount = visibleGenerations.filter((g) => g.status !== 'assembling').length;
            const promotedPendingCount = visibleGenerations.filter((g) => g.status === 'promoted').length;
            const uatOpen = expandedUat[section.projectKey] ?? true;

            return (
              <section key={section.projectKey} data-testid={`merge-train-project-${section.projectKey}`}>
                <div className="flex items-center gap-2 border-b border-border pb-1">
                  <h3 className="text-[11px] font-bold text-foreground">{section.projectName}</h3>
                  <span className="text-[10px] text-muted-foreground">
                    {section.enabled ? 'merge train on' : 'merge train off'}
                  </span>
                  {featureCount > 0 && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {featureCount} feature{featureCount === 1 ? '' : 's'}
                      {batchCount > 0 ? ` · ${batchCount} batch${batchCount === 1 ? '' : 'es'}` : ''}
                    </span>
                  )}
                </div>

                {!section.enabled ? (
                  <p className="px-1 py-1.5 text-[11px] text-muted-foreground">
                    The merge train is turned off for {section.projectName}, so no batches assemble here. Turn it on in the project cockpit to start batching this project's ready work.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="px-1 pb-1 text-[11px] leading-snug text-muted-foreground">
                      {featureCount === 0 && promotedPendingCount > 0 ? (
                        <><span className="font-semibold text-foreground">{promotedPendingCount} promoted batch{promotedPendingCount === 1 ? '' : 'es'}</span> await{promotedPendingCount === 1 ? 's' : ''} version ship. Supply the version below to satisfy each member&apos;s ship row.</>
                      ) : (
                        <><span className="font-semibold text-foreground">{featureCount} feature{featureCount === 1 ? '' : 's'}</span> passed review &amp; tests.
                          {batchCount > 0
                            ? ' They’re assembled into the test batches below — open a batch’s frontend, run its checklist, then merge that batch to main.'
                            : ' A test batch assembles automatically when the merge train is on.'}</>
                      )}
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
                          const isPromoted = gen.status === 'promoted';
                          return (
                            <div
                              key={gen.name}
                              className={`rounded-lg border p-2 ${isSuperseded ? 'border-border opacity-75' : isPromoted ? 'border-amber-500/35 bg-amber-500/[0.04]' : 'border-emerald-500/35 bg-emerald-500/[0.04]'}`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] ${isSuperseded ? 'text-muted-foreground' : isPromoted ? 'text-amber-400' : 'text-emerald-400'}`}>{isSuperseded ? '○' : '●'}</span>
                                <span className={`font-mono text-[11px] font-bold ${isSuperseded ? 'text-foreground' : isPromoted ? 'text-amber-400' : 'text-emerald-400'}`}>{shortName(gen.name)}</span>
                                <span className="ml-auto text-[10px] text-muted-foreground">{isSuperseded ? 'superseded · still testable' : isPromoted ? 'promoted · version pending' : 'ready to test'}</span>
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
                              {gen.stack.status === 'degraded' && (
                                <div className="mt-0.5 pl-4 text-[10px] text-amber-400" data-testid={`uat-stack-degraded-detail-${gen.name}`}>
                                  stack degraded — {(gen.stack.downServices ?? []).join(', ') || 'a declared service'} not serving
                                  {Object.entries(gen.stack.serviceErrors ?? {}).map(([service, line]) => (
                                    <div key={service} className="truncate font-mono text-[9.5px] text-muted-foreground" title={line}>
                                      {service}: {line}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
                                {!isPromoted && <StackButton gen={gen} compact={isSuperseded} />}
                                {isPromoted ? (
                                  <button
                                    type="button"
                                    disabled={shipMutation.isPending}
                                    onClick={() => setVersionAction({ generationName: gen.name, mode: 'ship', version: '' })}
                                    className="rounded border border-amber-500/50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                                  >
                                    {shipMutation.isPending && shipMutation.variables?.name === gen.name ? 'Shipping…' : 'Ship version'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={promoteMutation.isPending}
                                    onClick={() => void onPromote(gen)}
                                    className="rounded-md bg-emerald-500 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-950 hover:brightness-110 disabled:opacity-50"
                                  >
                                    {promoteMutation.isPending && promoteMutation.variables?.name === gen.name ? 'Merging…' : `Merge batch (${gen.members.length}) to main`}
                                  </button>
                                )}
                                {!isSuperseded && !isPromoted && (
                                  <button
                                    type="button"
                                    disabled={rebuildMutation.isPending}
                                    onClick={() => void onRebuild(section, gen)}
                                    title="Re-merge the ready features onto a fresh branch off current main — use if you suspect this batch is stale"
                                    className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                                  >
                                    {rebuildMutation.isPending && rebuildMutation.variables === section.projectKey ? '…' : '↻'}
                                  </button>
                                )}
                              </div>
                              {versionAction?.generationName === gen.name && (
                                <div className="mt-2 ml-4 border-l border-border pl-2" data-testid={`version-action-${gen.name}`}>
                                  <label className="block text-[10px] font-semibold text-foreground" htmlFor={`version-${gen.name}`}>
                                    Version (X.Y.Z)
                                  </label>
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <input
                                      id={`version-${gen.name}`}
                                      aria-label={`Version for ${shortName(gen.name)}`}
                                      value={versionAction.version}
                                      onChange={(event) => setVersionAction({ ...versionAction, version: event.target.value, error: undefined })}
                                      placeholder="48.8.0"
                                      className="w-28 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
                                    />
                                    <button
                                      type="button"
                                      disabled={promoteMutation.isPending || shipMutation.isPending}
                                      onClick={() => void submitVersionAction(gen)}
                                      className="rounded border border-border px-2 py-1 text-[10.5px] font-semibold text-foreground hover:bg-accent disabled:opacity-50"
                                    >
                                      {versionAction.mode === 'promote' ? 'Continue to merge' : 'Continue to ship'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setVersionAction(null)}
                                      className="px-1 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  {versionAction.error ? (
                                    <p className="mt-1 text-[10px] text-red-400">{versionAction.error}</p>
                                  ) : versionAction.mode === 'promote' && versionAction.version.trim() === '' ? (
                                    <p className="mt-1 text-[10px] leading-snug text-amber-400">
                                      No version supplied — the batch merges without a version bump and each member&apos;s ship row will fail until you ship one.
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <p className="px-1 text-[9.5px] leading-snug text-muted-foreground">
                          {visibleGenerations.every((generation) => generation.status === 'promoted')
                            ? 'This batch is already on main; only its configured version-string propagation remains.'
                            : 'Batches build automatically from the ready features. Nothing here merges to main until you say so.'}
                        </p>
                      </>
                    )}

                    {currentBatch && currentBatch.members.length > 0 && (
                      <>
                        <ZoneHeader>
                          <button
                            type="button"
                            className="uppercase tracking-wider hover:text-foreground"
                            onClick={() => setExpandedUat((prev) => ({ ...prev, [section.projectKey]: !uatOpen }))}
                          >
                            {uatOpen ? '▾' : '▸'} What to UAT — {shortName(currentBatch.name)}
                          </button>
                        </ZoneHeader>
                        {uatOpen && (
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
                                    {member.planResolved === false ? (
                                      // PAN-3165: a lookup miss must never render as a claim about
                                      // the plan's contents — say the plan is unresolved and name it.
                                      <li className="text-[10.5px] italic text-muted-foreground">
                                        Plan not found for {member.issueId} — its UAT checklist could not be read; exercise the feature described above.
                                      </li>
                                    ) : member.acceptanceCriteria.length === 0 ? (
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

                    {section.queue.length > 0 && (
                      <>
                        <ZoneHeader>Ready features (merge order)</ZoneHeader>
                        {section.queue.map((item) => {
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
                            onClick={() => void onMergeOne(section)}
                            className="rounded border border-border px-2 py-0.5 text-[10.5px] text-foreground hover:bg-accent disabled:opacity-50"
                          >
                            {mergeOneMutation.isPending && mergeOneMutation.variables === section.projectKey ? 'Merging…' : 'Merge one feature to main…'}
                          </button>
                        </div>
                        <p className="px-1 text-[9.5px] leading-snug text-muted-foreground">
                          Merging a single feature invalidates the live batches — a fresh batch reassembles automatically. Prefer merging a tested batch.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </section>
              );
            })}
          </div>
          {idleHiddenCount > 0 && (
            <p
              className="px-1 pt-1 text-[10.5px] text-muted-foreground"
              data-testid="merge-train-idle-hidden-note"
            >
              {idleHiddenCount} project{idleHiddenCount === 1 ? '' : 's'} with nothing ready{' '}
              {idleHiddenCount === 1 ? 'is' : 'are'} hidden
            </p>
          )}
        </>
      )}
    </div>
  );
}
