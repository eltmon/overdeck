/**
 * The Deft Directive state of one issue, read from its worktree (PAN-4849
 * WI-1, FR-13).
 *
 * `readDeftIssueState` parses every Directive file the dashboard shows:
 * scope xBRIEFs, escalations, subagent heartbeats, decision records,
 * approved scopes, the policy, the spec-drift ledger, the finish loop, the
 * run summary's gate runs, the reviewer config and the CLEAN records. It
 * reads with `fs/promises` only and never throws: a missing directory is
 * empty, and a malformed file is skipped with a `<path>: <message>` entry in
 * `errors`.
 *
 * The reader itself spawns nothing. The one input that needs git is whether
 * the project is natively a Directive project, which PAN-4820 reads from the
 * default branch's committed tree, never from worktree files
 * (`isNativeDirectiveProject` in `archive.ts`: one `git rev-parse` and three
 * `git show`, each with a timeout, and the async project config). It is
 * consulted only when the worktree has no install snapshot, and its answer is
 * memoized per worktree for 10 minutes, because it changes only when the
 * default branch gains or loses a deposit; `clearDeftModeCache` drops it
 * after a pipeline switch. A failed check counts as "not native" and is not
 * memoized. Tests inject the check.
 */
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DeftApprovedScope,
  DeftCleanRecord,
  DeftDecisionRecord,
  DeftEscalation,
  DeftEscalationType,
  DeftFinishLoopEntry,
  DeftGateRun,
  DeftHeartbeat,
  DeftIssueState,
  DeftIssueSummary,
  DeftPolicy,
  DeftScope,
  DeftScopeFolder,
  DeftScopeItem,
  DeftSpecDrift,
} from '@overdeck/contracts';
import { isNativeDirectiveProject } from './archive.js';
import { readDeftSnapshot } from './install-snapshot.js';
import { detectDrift } from './merge-guard.js';
import { readDeftPolicy, requireHumanMergeOf } from './policy.js';

export const DEFT_SCOPE_FOLDERS: readonly DeftScopeFolder[] = ['proposed', 'pending', 'active', 'completed', 'cancelled'];
const ESCALATION_TYPES: readonly DeftEscalationType[] = ['cmd_approval', 'design_decision', 'approval', 'resource', 'external', 'question'];
const GATE_STATUSES = ['run', 'skipped', 'failed'] as const;
const TAIL_LINES = 50;
const HOUR_MS = 3_600_000;

export interface DeftStateReaderDeps {
  /** Defaults to the memoized `isNativeDirectiveProject` from `archive.ts`, which runs git. */
  isNativeDirectiveProject?: (worktree: string) => Promise<boolean>;
}

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
/** The camelCase field, else its snake_case alias. */
const field = (rec: Rec, camel: string, snake: string): unknown => rec[camel] ?? rec[snake];

/** Copy only the defined values, so optional fields are absent rather than undefined. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Sorted file names in `dir` ending with `suffix`; a missing directory is empty. */
async function listFiles(dir: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && entry.name.endsWith(suffix)).map(entry => entry.name).sort();
  } catch {
    return [];
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse each `<relDir>/*<suffix>` JSON file with `parse`. A file that is not
 * JSON, or that `parse` rejects (returns a string), becomes an error entry.
 */
async function readJsonDir<T>(
  worktree: string,
  relDir: string,
  suffix: string,
  parse: (value: unknown, relPath: string) => T | string,
  errors: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (const name of await listFiles(join(worktree, relDir), suffix)) {
    const relPath = `${relDir}/${name}`;
    const text = await readText(join(worktree, relPath));
    if (text === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      errors.push(`${relPath}: invalid JSON`);
      continue;
    }
    const parsed = parse(value, relPath);
    if (typeof parsed === 'string') errors.push(`${relPath}: ${parsed}`);
    else out.push(parsed);
  }
  return out;
}

/** Every parseable JSON line of a JSONL file; bad lines become one error entry. */
async function readJsonLines(worktree: string, relPath: string, errors: string[]): Promise<unknown[]> {
  const text = await readText(join(worktree, relPath));
  if (text === null) return [];
  const rows: unknown[] = [];
  const bad: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      bad.push(index + 1);
    }
  });
  if (bad.length) errors.push(`${relPath}: invalid JSON on line${bad.length > 1 ? 's' : ''} ${bad.join(', ')}`);
  return rows;
}

function parseScopeItem(value: unknown): DeftScopeItem | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const evidence = value['x-directive/evidence'];
  const disposition = value['x-directive/disposition'];
  const provenance = isRecord(disposition) && isRecord(disposition.provenance) ? disposition.provenance : {};
  return defined<DeftScopeItem>({
    id: value.id,
    title: str(value.title) ?? '',
    status: str(value.status) ?? '',
    evidence:
      isRecord(evidence) && typeof evidence.kind === 'string' && typeof evidence.pointer === 'string'
        ? defined({
            kind: evidence.kind,
            pointer: evidence.pointer,
            recordedAt: str(field(evidence, 'recordedAt', 'recorded_at')),
            recordedBy: str(field(evidence, 'recordedBy', 'recorded_by')),
          })
        : undefined,
    disposition:
      isRecord(disposition) && typeof disposition.disposition === 'string'
        ? defined({
            disposition: disposition.disposition,
            reason: str(disposition.reason),
            provenanceKind: str(provenance.kind),
            actor: str(provenance.actor),
            recordedAt: str(field(disposition, 'recordedAt', 'recorded_at')),
          })
        : undefined,
  });
}

function parseScope(value: unknown, relPath: string, folder: DeftScopeFolder): DeftScope | string {
  const plan = isRecord(value) ? value.plan : undefined;
  if (!isRecord(plan) || typeof plan.id !== 'string') return 'not a scope xBRIEF (no plan.id)';
  const metadata = isRecord(plan.metadata) ? plan.metadata : {};
  const swarm = metadata.swarm;
  const pr = metadata.productPullRequest;
  const items = Array.isArray(plan.items) ? plan.items.map(parseScopeItem).filter((item): item is DeftScopeItem => item !== null) : [];
  return defined<DeftScope>({
    path: relPath,
    folder,
    planId: plan.id,
    title: str(plan.title) ?? '',
    status: str(plan.status) ?? '',
    items,
    swarm: isRecord(swarm)
      ? defined({ dependsOn: strings(swarm.depends_on), conflictGroup: str(swarm.conflict_group), fileScope: strings(swarm.file_scope) })
      : undefined,
    handoffState: str(metadata.handoffState),
    deliveryDisposition: str(metadata.deliveryDisposition),
    prNumber: num(pr) ?? (isRecord(pr) ? num(pr.number) : undefined),
  });
}

function parseEscalation(value: unknown, now: number): DeftEscalation | string {
  if (!isRecord(value)) return 'not an escalation object';
  const type = value.type;
  const createdAt = str(field(value, 'createdAt', 'created_at'));
  const slaHours = num(field(value, 'slaHours', 'sla_hours'));
  const status = value.status;
  if (typeof value.id !== 'string') return 'escalation has no id';
  if (!ESCALATION_TYPES.includes(type as DeftEscalationType)) return `unknown escalation type ${JSON.stringify(type)}`;
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return 'escalation has no valid createdAt';
  if (slaHours === undefined) return 'escalation has no slaHours';
  if (status !== 'open' && status !== 'resolved') return `unknown escalation status ${JSON.stringify(status)}`;
  const dueMs = Date.parse(createdAt) + slaHours * HOUR_MS;
  const resolution = value.resolution;
  return defined<DeftEscalation>({
    id: value.id,
    agentId: str(field(value, 'agentId', 'agent_id')) ?? '',
    type: type as DeftEscalationType,
    title: str(value.title) ?? '',
    body: str(value.body) ?? '',
    createdAt,
    slaHours,
    dueAt: new Date(dueMs).toISOString(),
    overdue: status === 'open' && now > dueMs,
    status,
    dangerous: value.dangerous === true,
    resolution: isRecord(resolution)
      ? defined({
          decision: str(resolution.decision) ?? '',
          resolvedAt: str(field(resolution, 'resolvedAt', 'resolved_at')) ?? '',
          resolvedBy: str(field(resolution, 'resolvedBy', 'resolved_by')) ?? '',
          note: str(resolution.note),
          answer: str(resolution.answer),
        })
      : undefined,
  });
}

function parseHeartbeat(value: unknown): DeftHeartbeat | string {
  if (!isRecord(value)) return 'not a heartbeat object';
  const agentId = str(value.agent_id);
  const parentId = str(value.parent_id);
  const lastHeartbeatAt = str(value.last_heartbeat_at);
  const lastMessage = str(value.last_message);
  const phase = str(value.phase);
  if (agentId === undefined || parentId === undefined || lastHeartbeatAt === undefined || lastMessage === undefined || phase === undefined) {
    return 'heartbeat is missing a required field';
  }
  return defined<DeftHeartbeat>({
    agentId,
    parentId,
    lastHeartbeatAt,
    lastMessage,
    phase,
    terminalState: str(value.terminal_state),
    prNumber: num(value.pr_number),
    waitKind: str(value.wait_kind),
  });
}

function parseDecision(value: unknown): DeftDecisionRecord | string {
  if (!isRecord(value) || typeof value.id !== 'string') return 'decision record has no id';
  return {
    id: value.id,
    decision: str(value.decision) ?? '',
    whyWinner: str(value.whyWinner) ?? '',
    confidence: str(value.confidence) ?? '',
    timestamp: str(value.timestamp) ?? '',
    activeScopeRefs: strings(value.activeScopeRefs),
  };
}

function parseApprovedScope(value: unknown): DeftApprovedScope | string {
  if (!isRecord(value)) return 'not an approved-scope object';
  const { planId, xbriefRelPath, approvedAt, humanApproval } = value;
  if (typeof planId !== 'string' || typeof xbriefRelPath !== 'string' || typeof approvedAt !== 'string') {
    return 'approved scope is missing planId, xbriefRelPath or approvedAt';
  }
  return defined<DeftApprovedScope>({
    planId,
    xbriefRelPath,
    approvedAt,
    fileScope: strings(value.fileScope),
    humanApproval:
      isRecord(humanApproval) && typeof humanApproval.kind === 'string' && typeof humanApproval.actor === 'string'
        ? { kind: humanApproval.kind, actor: humanApproval.actor }
        : undefined,
  });
}

function parseCleanRecord(value: unknown): DeftCleanRecord | string {
  if (!isRecord(value)) return 'not a CLEAN record';
  const prNumber = num(value.pr_number);
  const headSha = str(value.head_sha);
  const cleanedAt = str(value.cleaned_at);
  if (prNumber === undefined || headSha === undefined || cleanedAt === undefined) return 'CLEAN record is missing a required field';
  return { prNumber, headSha, cleanedAt };
}

function parseFinishLoopEntry(value: unknown): DeftFinishLoopEntry | null {
  if (!isRecord(value) || typeof value.ts !== 'string') return null;
  return {
    ts: value.ts,
    phase: str(value.phase) ?? '',
    iteration: num(value.iteration) ?? 0,
    haltReason: str(value.haltReason) ?? null,
    message: str(value.message) ?? '',
    prNumber: num(value.prNumber) ?? null,
  };
}

function parseGateRun(value: unknown): DeftGateRun | null {
  if (!isRecord(value) || value.event !== 'check_invocation' || !isRecord(value.payload)) return null;
  const payload = value.payload;
  const gates = Array.isArray(payload.gates) ? payload.gates : [];
  return {
    ts: str(value.ts) ?? '',
    target: str(payload.target) ?? '',
    exitCode: num(payload.exit_code) ?? 0,
    gates: gates.flatMap(gate => {
      if (!isRecord(gate) || typeof gate.id !== 'string') return [];
      const status = GATE_STATUSES.find(s => s === gate.status);
      if (!status) return [];
      return [defined({ id: gate.id, status, exitCode: num(gate.exit_code), cause: str(gate.cause) })];
    }),
  };
}

async function readPolicy(worktree: string): Promise<DeftPolicy> {
  const read = await readDeftPolicy(worktree);
  const raw = read.policy ?? {};
  const review = isRecord(raw.review) ? raw.review : {};
  const reviewers = Array.isArray(review.reviewers) && review.reviewers.every(r => typeof r === 'string') ? (review.reviewers as string[]) : null;
  const floor = review.minGreptileConfidence;
  return {
    raw,
    requireHumanMerge: read.readable ? requireHumanMergeOf(read) : 'unknown',
    reviewers,
    minGreptileConfidence: typeof floor === 'number' && Number.isInteger(floor) && floor >= 1 && floor <= 5 ? floor : 4,
  };
}

async function readSpecDrift(worktree: string, errors: string[]): Promise<DeftSpecDrift> {
  const relPath = 'xbrief/.audit/spec-drift-ledger.json';
  const text = await readText(join(worktree, relPath));
  if (text === null) return { unresolved: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    errors.push(`${relPath}: invalid JSON`);
    return { unresolved: [] };
  }
  const unresolved = isRecord(value) && Array.isArray(value.unresolved) ? value.unresolved : [];
  return {
    unresolved: unresolved.flatMap(entry =>
      isRecord(entry) && typeof entry.scopeId === 'string'
        ? [{ scopeId: entry.scopeId, reason: str(entry.reason) ?? '', specImpact: str(entry.specImpact) ?? '' }]
        : [],
    ),
  };
}

const NATIVE_CACHE_MS = 10 * 60_000;
const nativeCache = new Map<string, { at: number; native: boolean }>();

/** Forget the memoized native-project answer (one worktree, or all). */
export function clearDeftModeCache(worktree?: string): void {
  if (worktree) nativeCache.delete(worktree);
  else nativeCache.clear();
}

async function nativeFor(worktree: string, deps: DeftStateReaderDeps): Promise<boolean> {
  if (deps.isNativeDirectiveProject) {
    try {
      return await deps.isNativeDirectiveProject(worktree);
    } catch {
      return false;
    }
  }
  const hit = nativeCache.get(worktree);
  if (hit && Date.now() - hit.at < NATIVE_CACHE_MS) return hit.native;
  try {
    const native = await isNativeDirectiveProject(worktree);
    nativeCache.set(worktree, { at: Date.now(), native });
    return native;
  } catch {
    return false;
  }
}

export async function readDeftIssueState(
  worktree: string,
  issueId: string,
  now: number = Date.now(),
  deps: DeftStateReaderDeps = {},
): Promise<DeftIssueState> {
  // One error list per source, joined in a fixed order so `errors` is stable.
  const scopeErrors: string[] = [];
  const escalationErrors: string[] = [];
  const heartbeatErrors: string[] = [];
  const decisionErrors: string[] = [];
  const approvedErrors: string[] = [];
  const driftErrors: string[] = [];
  const finishErrors: string[] = [];
  const gateErrors: string[] = [];
  const cleanErrors: string[] = [];

  const snapshot = await readDeftSnapshot(worktree);
  const [
    mode,
    scopesByFolder,
    escalations,
    heartbeats,
    decisions,
    approvedScopes,
    policy,
    specDrift,
    installDrift,
    finishRows,
    summaryRows,
    reviewerConfigPresent,
    cleanRecords,
  ] = await Promise.all([
    snapshot
      ? Promise.resolve<DeftIssueState['mode']>('temporary-install')
      : nativeFor(worktree, deps).then(native =>
          native ? ('directive-project' as const) : ('not-installed' as const),
        ),
    Promise.all(
      DEFT_SCOPE_FOLDERS.map(folder =>
        readJsonDir(worktree, `xbrief/${folder}`, '.xbrief.json', (value, relPath) => parseScope(value, relPath, folder), scopeErrors),
      ),
    ),
    readJsonDir(worktree, '.deft/escalations', '.json', value => parseEscalation(value, now), escalationErrors),
    readJsonDir(worktree, '.deft-scratch/subagent-status', '.json', parseHeartbeat, heartbeatErrors),
    readJsonDir(worktree, 'xbrief/decisions', '.decision.json', parseDecision, decisionErrors),
    readJsonDir(worktree, '.deft/approved-scope', '.json', parseApprovedScope, approvedErrors),
    readPolicy(worktree),
    readSpecDrift(worktree, driftErrors),
    detectDrift(worktree, snapshot).catch(() => []),
    readJsonLines(worktree, '.deft-cache/finish-loop-progress.jsonl', finishErrors),
    readJsonLines(worktree, '.overdeck/deft-run-summary.jsonl', gateErrors),
    Promise.all([exists(join(worktree, 'greptile.json')), exists(join(worktree, '.greptile', 'config.json'))]).then(([a, b]) => a || b),
    readJsonDir(worktree, '.deft-scratch/merge-path-arm', '.clean.json', parseCleanRecord, cleanErrors),
  ]);

  escalations.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });

  return {
    issueId,
    pipeline: 'deft',
    mode,
    scopes: scopesByFolder.flat(),
    escalations,
    heartbeats,
    decisions,
    approvedScopes,
    policy,
    specDrift,
    installDrift,
    liftConflicts: snapshot?.liftConflicts ?? [],
    finishLoop: finishRows
      .slice(-TAIL_LINES)
      .map(parseFinishLoopEntry)
      .filter((entry): entry is DeftFinishLoopEntry => entry !== null),
    gateRuns: summaryRows
      .map(parseGateRun)
      .filter((run): run is DeftGateRun => run !== null)
      .slice(-TAIL_LINES),
    reviewerConfigPresent,
    cleanRecords,
    errors: [
      ...scopeErrors,
      ...escalationErrors,
      ...heartbeatErrors,
      ...decisionErrors,
      ...approvedErrors,
      ...driftErrors,
      ...finishErrors,
      ...gateErrors,
      ...cleanErrors,
    ],
  };
}

/**
 * The batched board/tree row. `handoffState` is the first active scope's,
 * else the last scope (folder order) that carries one.
 */
export function summarizeDeftIssueState(state: DeftIssueState): DeftIssueSummary {
  const scopeCounts: DeftIssueSummary['scopeCounts'] = {};
  for (const scope of state.scopes) scopeCounts[scope.folder] = (scopeCounts[scope.folder] ?? 0) + 1;
  const withHandoff = state.scopes.filter(scope => scope.handoffState !== undefined);
  const handoff = withHandoff.find(scope => scope.folder === 'active') ?? withHandoff.at(-1);
  return {
    issueId: state.issueId,
    scopeCounts,
    specDriftUnresolved: state.specDrift.unresolved.length,
    installDrift: state.installDrift.length,
    handoffState: handoff?.handoffState ?? null,
    openEscalations: state.escalations.filter(escalation => escalation.status === 'open').length,
  };
}
