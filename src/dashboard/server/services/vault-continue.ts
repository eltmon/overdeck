/**
 * Session Vault "Continue here" (PAN-4437 FR-1..FR-13).
 *
 * `previewContinue` answers what continuing a record on this machine would do
 * and writes nothing: no git object, no file, no row. `continueHere` does it,
 * inside one `enqueueVaultOperation('continue')`: re-read the record and its
 * owner (D-6), resolve the target checkout (D-2), place the code snapshot
 * (D-4), re-check drift (D-5), adopt by CAS, then create the managed
 * conversation and launch it outside the queue, and finally remove the
 * browse row (D-12).
 *
 * The browser never chooses a directory: the target comes only from the
 * record and the registered projects. Every collaborator is injectable
 * through `VaultContinueDeps` so tests run without git, a vault or a DB.
 */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveCodexRolloutPath } from '../../../lib/agents/transcript-resolver.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import {
  allocateVaultContinueNames,
  createVaultContinuedConversation,
  launchVaultContinuedConversation,
} from '../../../lib/overdeck/conversation-vault-continue.js';
import { removeVaultBrowseRow } from '../../../lib/overdeck/conversation-vault-rows.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { listProjectsAsync } from '../../../lib/projects.js';
import { findProjectForGitOrigin } from '../../../lib/projects/origin-match.js';
import { parseRepoUrl } from '../../../lib/projects/repo-url.js';
import { recordCodexRolloutSession } from '../../../lib/runtimes/codex.js';
import { codexAgentHome } from '../../../lib/runtimes/storage/codex.js';
import { claudeProjectsRoot, sessionFilePath } from '../../../lib/runtimes/storage/claude-code.js';
import { adoptRecord } from '../../../lib/vault/adopt.js';
import { driftFields, driftNote, inspectContinue } from '../../../lib/vault/continue-inspect.js';
import { readCwdState } from '../../../lib/vault/cwd-state.js';
import { isPathUnder } from '../../../lib/vault/exclude.js';
import { isTombstone, readSessionRecord, refName, type SessionRecord } from '../../../lib/vault/format.js';
import { openVaultContext, type OpenVault } from '../../../lib/vault/open.js';
import { applyWipSnapshot, findLatestWip, isWipPresent, type WipApplyResult } from '../../../lib/vault/wip-apply.js';
import { performWorkspaceCreate, resolveWorkspaceCreateIntent } from '../../../lib/workspaces/create.js';
import { enqueueVaultOperation, vaultUnavailableMessage } from './vault-service.js';

export interface ContinuePreview {
  vaultId: string;
  title: string;
  harness: string;
  resumable: boolean;
  ownerLabel: string;
  ownerToken: string;
  ownedHere: boolean;
  target: null | { cwd: string; source: 'saved-cwd' | 'project'; projectKey: string | null; dirty: boolean; isGit: boolean };
  noTargetReason: null | 'clone-offered' | 'no-checkout';
  clone: null | { url: string; slug: string | null };
  wip: { kind: 'none' } | { kind: 'skipped'; reason: string } | { kind: 'captured'; at: string; bytes: number; branch: string | null; base: string };
  codePlacement: 'in-place' | 'new-workspace' | 'none';
  drift: string[];
  savedCwd: string;
}

export interface ContinueBody {
  expectedOwnerToken: string;
  onDrift?: 'continue' | 'note';
}

export interface Outcome<T = unknown> {
  status: number;
  body: T;
}

export interface VaultContinueDeps {
  openVaultContext: typeof openVaultContext;
  readRecord: (vaultId: string, vault: OpenVault) => Promise<SessionRecord | null>;
  ensureEnvironmentIdentity: typeof ensureEnvironmentIdentity;
  listProjectsAsync: typeof listProjectsAsync;
  findProjectForGitOrigin: typeof findProjectForGitOrigin;
  inspectContinue: typeof inspectContinue;
  isWipPresent: typeof isWipPresent;
  applyWipSnapshot: typeof applyWipSnapshot;
  resolveWorkspaceCreateIntent: typeof resolveWorkspaceCreateIntent;
  performWorkspaceCreate: typeof performWorkspaceCreate;
  adoptRecord: typeof adoptRecord;
  readCwdState: typeof readCwdState;
  enqueueVaultOperation: typeof enqueueVaultOperation;
  createVaultContinuedConversation: typeof createVaultContinuedConversation;
  launchVaultContinuedConversation: typeof launchVaultContinuedConversation;
  allocateVaultContinueNames: typeof allocateVaultContinueNames;
  recordCodexRolloutSession: typeof recordCodexRolloutSession;
  resolveCodexRolloutPath: typeof resolveCodexRolloutPath;
  removeVaultBrowseRow: typeof removeVaultBrowseRow;
  claudeProjectsRoot: typeof claudeProjectsRoot;
  pathIsDirectory: (path: string) => Promise<boolean>;
}

async function readRecordDefault(vaultId: string, vault: OpenVault): Promise<SessionRecord | null> {
  const name = refName('record', vaultId, vault.keys.K_ref);
  const ref = await vault.store.readRef(name);
  if (!ref) return null;
  const value = await readSessionRecord(name, ref.value, vault.keys);
  return value && !isTombstone(value) ? value : null;
}

async function pathIsDirectoryDefault(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function resolveDeps(overrides: Partial<VaultContinueDeps>): VaultContinueDeps {
  return {
    openVaultContext,
    readRecord: readRecordDefault,
    ensureEnvironmentIdentity,
    listProjectsAsync,
    findProjectForGitOrigin,
    inspectContinue,
    isWipPresent,
    applyWipSnapshot,
    resolveWorkspaceCreateIntent,
    performWorkspaceCreate,
    adoptRecord,
    readCwdState,
    enqueueVaultOperation,
    createVaultContinuedConversation,
    launchVaultContinuedConversation,
    allocateVaultContinueNames,
    recordCodexRolloutSession,
    resolveCodexRolloutPath,
    removeVaultBrowseRow,
    claudeProjectsRoot,
    pathIsDirectory: pathIsDirectoryDefault,
    ...overrides,
  };
}

/** D-6: an opaque owner fingerprint; the browser never sees an environment id. */
export function ownerToken(environmentId: string): string {
  return createHash('sha256').update(environmentId).digest('hex').slice(0, 16);
}

function isResumable(harness: string): harness is 'claude-code' | 'codex' {
  return harness === 'claude-code' || harness === 'codex';
}

const notFound = (vaultId: string): Outcome => ({ status: 404, body: { error: `No saved conversation matches ${vaultId.slice(0, 8)}.` } });
const conflict = (code: string, error: string, extra: Record<string, unknown> = {}): Outcome => ({ status: 409, body: { code, error, ...extra } });

interface ResolvedTarget {
  target: { cwd: string; source: 'saved-cwd' | 'project'; projectKey: string | null } | null;
  noTargetReason: 'clone-offered' | 'no-checkout' | null;
  clone: { url: string; slug: string | null } | null;
}

/** D-2: saved cwd, else the project matching the origin, else a clone offer, else nothing. */
async function resolveTarget(record: SessionRecord, deps: VaultContinueDeps): Promise<ResolvedTarget> {
  const projects = await deps.listProjectsAsync();
  const match = deps.findProjectForGitOrigin(record.gitOrigin, projects);
  if (record.cwd && (await deps.pathIsDirectory(record.cwd))) {
    const containing = projects.find((project) => isPathUnder(record.cwd, project.config.path));
    return { target: { cwd: record.cwd, source: 'saved-cwd', projectKey: containing?.key ?? match?.key ?? null }, noTargetReason: null, clone: null };
  }
  if (match && (await deps.pathIsDirectory(match.config.path))) {
    return { target: { cwd: match.config.path, source: 'project', projectKey: match.key }, noTargetReason: null, clone: null };
  }
  const parsed = record.gitOrigin ? parseRepoUrl(record.gitOrigin) : null;
  if (parsed) return { target: null, noTargetReason: 'clone-offered', clone: { url: parsed.cloneUrl, slug: parsed.slug } };
  return { target: null, noTargetReason: 'no-checkout', clone: null };
}

function noTargetMessage(record: SessionRecord, resolved: ResolvedTarget): string {
  const id8 = record.vaultId.slice(0, 8);
  if (resolved.clone) {
    return `No registered project matches ${resolved.clone.slug ?? resolved.clone.url}. Clone and register it first, or run: pan vault resume ${id8} --cwd <dir>`;
  }
  return `The saved working directory ${record.cwd || '(none)'} does not exist here and the record has no git origin. Run: pan vault resume ${id8} --cwd <dir>`;
}

export async function previewContinue(vaultId: string, overrides: Partial<VaultContinueDeps> = {}): Promise<Outcome> {
  const deps = resolveDeps(overrides);
  const opened = await deps.openVaultContext();
  if (opened.status !== 'open') return conflict('vault-unavailable', vaultUnavailableMessage(opened));
  const record = await deps.readRecord(vaultId, opened.vault);
  if (!record) return notFound(vaultId);
  const me = await deps.ensureEnvironmentIdentity();
  const resolved = await resolveTarget(record, deps);
  const inspection = resolved.target ? await deps.inspectContinue(record, resolved.target.cwd) : null;
  const wip = inspection?.wip ?? { kind: 'none' as const };
  const preview: ContinuePreview = {
    vaultId,
    title: record.title,
    harness: record.harness,
    resumable: isResumable(record.harness),
    ownerLabel: record.owner.label,
    ownerToken: ownerToken(record.owner.environmentId),
    ownedHere: record.owner.environmentId === me.environmentId,
    target: resolved.target && inspection ? { ...resolved.target, dirty: inspection.dirty, isGit: inspection.isGit } : null,
    noTargetReason: resolved.noTargetReason,
    clone: resolved.clone,
    wip: wip.kind === 'captured' ? { kind: 'captured', at: wip.at, bytes: wip.bytes, branch: wip.branch, base: wip.base } : wip,
    codePlacement: inspection?.codePlacement ?? 'none',
    drift: inspection?.drift ?? [],
    savedCwd: record.cwd,
  };
  return { status: 200, body: preview };
}

type CodeStep =
  | { kind: 'none' }
  | { kind: 'placed'; cwd: string; written: boolean; workspacePath: string | null; note?: string }
  | { kind: 'refused'; outcome: Outcome };

/** D-4: Create `scratch/vault-<id8>` (or -2..-9 when the path exists) in `projectKey`. */
async function createScratchWorkspace(record: SessionRecord, projectKey: string, deps: VaultContinueDeps): Promise<string> {
  const base = `vault-${record.vaultId.slice(0, 8)}`;
  let lastMessage = '';
  for (let attempt = 1; attempt <= 9; attempt++) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    const intent = await deps.resolveWorkspaceCreateIntent({ kind: 'scratch', isolated: true, projectKey, name, refreshParentBranch: true });
    const finding = intent.findings[0];
    if (finding?.code === 'path-exists') {
      lastMessage = finding.message;
      continue;
    }
    if (finding) throw new Error(finding.message);
    await deps.performWorkspaceCreate(intent);
    if (!intent.path) throw new Error('Workspace intent did not resolve to a path.');
    return intent.path;
  }
  throw new Error(lastMessage);
}

async function placeCode(record: SessionRecord, vault: OpenVault, targetCwd: string, projectKey: string | null, deps: VaultContinueDeps): Promise<CodeStep> {
  const wip = findLatestWip(record);
  if (!wip || !('objects' in wip)) return { kind: 'none' };
  const state = await deps.readCwdState(targetCwd);
  if (state === null) return { kind: 'none' };
  const apply = (cwd: string): Promise<WipApplyResult> =>
    deps.applyWipSnapshot({ cwd, vaultId: record.vaultId, wip, store: vault.store, keys: vault.keys });
  let result: WipApplyResult;
  let workspacePath: string | null = null;
  if (!state.dirty) {
    result = await apply(targetCwd);
  } else {
    if (await deps.isWipPresent(targetCwd, wip)) return { kind: 'placed', cwd: targetCwd, written: false, workspacePath: null };
    if (!projectKey) {
      return {
        kind: 'refused',
        outcome: conflict(
          'dirty-unregistered',
          `${targetCwd} has uncommitted changes and is not a registered project, so no workspace can be created for the code snapshot. Commit or move the changes, or run: pan vault resume ${record.vaultId.slice(0, 8)} --worktree <dir>`,
        ),
      };
    }
    workspacePath = await createScratchWorkspace(record, projectKey, deps);
    result = await apply(workspacePath);
  }
  if (result.status === 'failed') return { kind: 'refused', outcome: conflict('wip-failed', `Cannot apply the code snapshot: ${result.reason}`) };
  if (result.status === 'dirty') return { kind: 'refused', outcome: conflict('wip-failed', `Cannot apply the code snapshot: ${result.cwd} has uncommitted changes`) };
  return { kind: 'placed', cwd: result.cwd, written: true, workspacePath, ...(result.note ? { note: result.note } : {}) };
}

export async function continueHere(vaultId: string, body: ContinueBody, overrides: Partial<VaultContinueDeps> = {}): Promise<Outcome> {
  const deps = resolveDeps(overrides);
  return deps.enqueueVaultOperation('continue', async () => {
    try {
      return await runContinue(vaultId, body, deps);
    } catch (error) {
      return { status: 500, body: { error: (error as Error).message } };
    }
  });
}

async function runContinue(vaultId: string, body: ContinueBody, deps: VaultContinueDeps): Promise<Outcome> {
  const opened = await deps.openVaultContext();
  if (opened.status !== 'open') return conflict('vault-unavailable', vaultUnavailableMessage(opened));
  const vault = opened.vault;
  const record = await deps.readRecord(vaultId, vault);
  if (!record) return notFound(vaultId);
  const id8 = vaultId.slice(0, 8);
  const harness = record.harness;
  if (!isResumable(harness)) {
    return { status: 400, body: { error: `${harness} has no native resume. Run: pan vault resume ${id8}` } };
  }
  const me = await deps.ensureEnvironmentIdentity();
  if (record.owner.environmentId === me.environmentId) {
    return conflict('owned-here', 'This conversation is already owned by this machine.');
  }
  if (ownerToken(record.owner.environmentId) !== body.expectedOwnerToken) {
    return conflict('already-continued', `Already continued on ${record.owner.label}.`, { label: record.owner.label, codeAppliedAt: null });
  }

  const resolved = await resolveTarget(record, deps);
  if (!resolved.target) return conflict('no-target', noTargetMessage(record, resolved));

  const code = await placeCode(record, vault, resolved.target.cwd, resolved.target.projectKey, deps);
  if (code.kind === 'refused') return code.outcome;
  const targetCwd = code.kind === 'placed' ? code.cwd : resolved.target.cwd;
  const codeAppliedAt = code.kind === 'placed' && code.written ? new Date().toISOString() : null;

  const fields = driftFields(record, await deps.readCwdState(targetCwd), code.kind === 'placed');
  if (fields.length > 0 && !body.onDrift) {
    return conflict('drift', `The working directory differs from where this conversation was saved: ${fields.join(', ')}.`, { fields });
  }
  const note = fields.length > 0 && body.onDrift === 'note' ? driftNote(fields) : null;

  const names = deps.allocateVaultContinueNames();
  const outcome = await deps.adoptRecord({
    vaultId,
    store: vault.store,
    keys: vault.keys,
    targetCwd,
    identity: me,
    ...(harness === 'codex'
      ? { codexHome: codexAgentHome(join(getOverdeckHome(), 'agents', names.tmuxSession)) }
      : { projectsRoot: deps.claudeProjectsRoot() }),
  });
  if (!outcome.adopted) {
    const label = outcome.alreadyContinuedOn;
    return conflict('already-continued', `Already continued on ${label}.`, { label, codeAppliedAt });
  }

  if (harness === 'codex') {
    // D-9: the managed conversation reads its rollout from its own agent directory.
    deps.recordCodexRolloutSession(names.tmuxSession, outcome.newSessionId, outcome.path);
    const resolvedRollout = await deps.resolveCodexRolloutPath(names.tmuxSession);
    if (resolvedRollout !== outcome.path) {
      return { status: 500, body: { error: `Codex continue could not place the rollout where the managed conversation reads it. Run: pan vault resume ${id8}` } };
    }
  } else {
    const expected = sessionFilePath(targetCwd, outcome.newSessionId);
    if (outcome.path !== expected) {
      return {
        status: 500,
        body: {
          error: `Materialized transcript ${outcome.path} is not where Claude Code resumes ${expected}. The conversation is adopted; run: cd ${targetCwd} && claude --resume ${outcome.newSessionId}`,
        },
      };
    }
  }

  const conv = deps.createVaultContinuedConversation({
    ...names,
    cwd: targetCwd,
    newSessionId: outcome.newSessionId,
    harness,
    title: record.title,
    model: record.model,
    projectKey: resolved.target.projectKey,
  });
  void deps.launchVaultContinuedConversation(conv, note);
  try {
    deps.removeVaultBrowseRow(vaultId);
  } catch (error) {
    console.warn(`[vault] continue: browse row removal failed for ${vaultId}: ${(error as Error).message}`);
  }
  return {
    status: 200,
    body: {
      conversation: { name: conv.name, title: conv.title ?? record.title, cwd: targetCwd },
      codeApplied: code.kind === 'placed',
      workspacePath: code.kind === 'placed' ? code.workspacePath : null,
      ...(code.kind === 'placed' && code.note ? { note: code.note } : {}),
    },
  };
}
