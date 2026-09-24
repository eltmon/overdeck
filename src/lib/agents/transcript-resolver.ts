/**
 * Authoritative harness-aware transcript resolution for agents.
 *
 * Candidate ordering lives in session-history; candidates come from the
 * absolute path each harness's capture point recorded in the session index
 * at session start (PAN-3959), with per-harness path formulas applied only
 * to pre-PAN-3959 entries that predate that recording. Dashboard routes,
 * live streams, and enrichment all use this async resolver so there is no
 * second filesystem interpretation.
 */
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { claudeProjectDir, claudeProjectsRoot } from '../runtimes/storage/claude-code.js';
import { logAgentLifecycle } from '../persistent-logger.js';
import { acpTranscriptPath } from '../runtimes/storage/acp.js';
import { codexSessionsRoot, findLatestRollout, findRolloutPath } from '../runtimes/storage/codex.js';
import { findKimiWirePathAsync, kimiHomeDefault, kimiSessionsRoot, kimiWirePath } from '../runtimes/storage/kimi-code.js';
import {
  listMuseSessionPaths,
  museSessionId,
  museSessionsRoot,
  resolveMuseSessionPath,
} from '../runtimes/storage/muse.js';
import { findPiTranscriptPath, piSessionsRoot } from '../runtimes/storage/pi.js';
import {
  latestSessionResetTime,
  orderedTranscriptCandidates,
  parseSessionIndex,
  SESSION_RESET_MARKER,
  transcriptCandidateKey,
  transcriptCandidateKind,
  transcriptCandidateKinds,
  type SessionIndexEntry,
  type TranscriptCandidate,
} from '../session-history.js';
import { getAgentState } from './agent-state-read.js';

export interface ResolveJsonlPathOptions {
  agentsDirOverride?: string;
  claudeProjectsDirOverride?: string;
  kimiHomeOverride?: string;
  workspaceOverride?: string;
  getRuntimeStateAsync?: (agentId: string) => Promise<{
    claudeSessionId?: string;
    sessionModel?: string;
  } | null>;
  logDiagnostic?: (agentId: string, message: string) => void;
}

const transcriptResolutionSignatures = new Map<string, string>();

function logTranscriptResolution(
  agentId: string,
  signature: string,
  message: string,
  opts: ResolveJsonlPathOptions,
): void {
  const signatureKey = `${agentId}:${opts.agentsDirOverride ?? 'live'}`;
  if (transcriptResolutionSignatures.get(signatureKey) === signature) return;
  transcriptResolutionSignatures.set(signatureKey, signature);
  const logger = opts.logDiagnostic ?? (opts.agentsDirOverride ? undefined : logAgentLifecycle);
  logger?.(agentId, `transcript resolution: ${message}`);
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function readOptional(path: string): Promise<string | null> {
  return readFile(path, 'utf-8').catch(() => null);
}

async function readIndexedSessionEntries(agentDir: string): Promise<{
  entries: SessionIndexEntry[];
  exists: boolean;
  resetAt: number | null;
}> {
  const raw = await readOptional(join(agentDir, 'sessions.json'));
  return raw === null
    ? { entries: [], exists: false, resetAt: null }
    : { entries: parseSessionIndex(raw), exists: true, resetAt: latestSessionResetTime(raw) };
}

const LAUNCHER_UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const LAUNCHER_SESSION_ID_RE = new RegExp(`--session-id\\s+'?(${LAUNCHER_UUID})'?`);
const LAUNCHER_RESUME_RE = new RegExp(`--resume\\s+'?(${LAUNCHER_UUID})'?`);

export async function readLauncherPinnedSessionId(
  tmuxSession: string,
  opts: { overdeckHomeOverride?: string } = {},
): Promise<string | null> {
  const home = opts.overdeckHomeOverride ?? getOverdeckHome();
  for (const path of [
    join(home, 'conversations', tmuxSession, 'launcher.sh'),
    join(home, 'agents', tmuxSession, 'launcher.sh'),
  ]) {
    const text = await readOptional(path);
    if (!text) continue;
    const match = LAUNCHER_SESSION_ID_RE.exec(text) ?? LAUNCHER_RESUME_RE.exec(text);
    if (match) return match[1]!;
  }
  return null;
}

interface RecordedAgentState {
  harness: string | null;
  workspace?: string;
  sessionId?: string;
  model?: string;
}

async function readRecordedState(
  agentId: string,
  opts: ResolveJsonlPathOptions,
): Promise<RecordedAgentState> {
  if (opts.agentsDirOverride) {
    try {
      const raw = await readFile(join(opts.agentsDirOverride, agentId, 'state.json'), 'utf8');
      const state = JSON.parse(raw) as Record<string, unknown>;
      return {
        harness: typeof state.harness === 'string' ? state.harness : null,
        workspace: typeof state.workspace === 'string' ? state.workspace : undefined,
        sessionId: typeof state.sessionId === 'string' ? state.sessionId : undefined,
        model: typeof state.model === 'string' ? state.model : undefined,
      };
    } catch {
      return { harness: null };
    }
  }
  const state = getAgentState(agentId);
  return {
    harness: state?.harness ?? null,
    workspace: state?.workspace,
    sessionId: state?.sessionId,
    model: state?.model,
  };
}

function agentsRoot(opts: ResolveJsonlPathOptions): string {
  return opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
}

async function codexHomes(agentDir: string): Promise<string[]> {
  const entries = await readdir(agentDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('codex-home'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => join(agentDir, entry.name));
}

export async function resolveCodexRolloutPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentDir = join(agentsRoot(opts), agentId);
  const threadId = (await readOptional(join(agentDir, 'codex-thread-id')))?.trim();
  for (const codexHome of await codexHomes(agentDir)) {
    if (threadId) {
      const rollout = findRolloutPath(codexHome, threadId);
      if (rollout) return rollout;
    }
    const latest = findLatestRollout(codexHome);
    if (latest) return latest;
  }
  return null;
}

export async function resolveAcpTranscriptPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const path = acpTranscriptPath(agentId, agentsRoot(opts));
  return await pathExists(path) ? path : null;
}

export async function resolveKimiWirePath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const workspace = opts.workspaceOverride ?? (await readRecordedState(agentId, opts)).workspace;
  if (!workspace) return null;
  const sessionId = (await readOptional(join(agentsRoot(opts), agentId, 'kimi-session-id')))?.trim() || null;
  const kimiHome = opts.kimiHomeOverride ?? kimiHomeDefault();
  return findKimiWirePathAsync(kimiHome, workspace, sessionId);
}

export async function resolvePiSessionPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  return findPiTranscriptPath(join(agentsRoot(opts), agentId));
}

/** Runtime roots observed while a harness has not produced a concrete file. */
export async function listAgentTranscriptWatchRoots(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string[]> {
  const root = agentsRoot(opts);
  const agentDir = join(root, agentId);
  const recorded = await readRecordedState(agentId, opts);
  const workspace = recorded.workspace ?? workspacePath;
  const kind = transcriptCandidateKind(recorded.harness);
  if (kind === 'claude') {
    const projectsRoot = opts.claudeProjectsDirOverride ?? claudeProjectsRoot();
    return workspace ? [claudeProjectDir(workspace, projectsRoot)] : [];
  }
  if (kind === 'kimi') {
    const kimiHome = opts.kimiHomeOverride ?? kimiHomeDefault();
    return workspace ? [kimiSessionsRoot(kimiHome, workspace)] : [];
  }
  if (kind === 'codex') {
    const homes = await codexHomes(agentDir);
    return homes.length > 0 ? homes.map(home => codexSessionsRoot(home)) : [agentDir];
  }
  if (kind === 'pi' || kind === 'ohmypi') return [piSessionsRoot(agentDir)];
  if (kind === 'muse') return [museSessionsRoot(agentId, root)];
  if (kind === 'acp') return [dirname(acpTranscriptPath(agentId, root))];
  return [];
}

export async function listAgentTranscriptCandidates(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<TranscriptCandidate[]> {
  const root = agentsRoot(opts);
  const agentDir = join(root, agentId);
  if (await pathExists(join(agentDir, SESSION_RESET_MARKER))) return [];
  const recorded = await readRecordedState(agentId, opts);
  const currentHarness = recorded.harness;
  const effectiveWorkspace = recorded.workspace ?? workspacePath;
  const projectsRoot = opts.claudeProjectsDirOverride ?? claudeProjectsRoot();
  const projectDir = claudeProjectDir(effectiveWorkspace, projectsRoot);
  const kimiHome = opts.kimiHomeOverride ?? kimiHomeDefault();
  const index = await readIndexedSessionEntries(agentDir);
  const entries = [...index.entries];
  if (!index.exists) {
    const legacy = (await readOptional(join(agentDir, 'session.id')))?.trim();
    if (legacy) entries.push({ sessionId: legacy, at: '', source: 'legacy-pointer' });
  }

  const indexedPaths = new Map<string, string>();
  const homes = await codexHomes(agentDir);
  const musePaths = await listMuseSessionPaths(agentId, root);
  for (const entry of entries) {
    if (entry.path) {
      indexedPaths.set(transcriptCandidateKey(transcriptCandidateKind(entry.harness ?? currentHarness), entry.sessionId), entry.path);
      continue;
    }
    for (const kind of transcriptCandidateKinds(entry.harness, currentHarness)) {
      let path: string | null = null;
      if (kind === 'claude') path = join(projectDir, `${entry.sessionId}.jsonl`);
      else if (kind === 'kimi') {
        path = kimiWirePath(kimiHome, effectiveWorkspace, entry.sessionId);
      } else if (kind === 'codex') {
        for (const home of homes) {
          path = findRolloutPath(home, entry.sessionId);
          if (path) break;
        }
      } else if (kind === 'pi' || kind === 'ohmypi') {
        path = await findPiTranscriptPath(agentDir, entry.sessionId);
      } else if (kind === 'acp') path = acpTranscriptPath(agentId, root);
      else if (kind === 'muse') path = musePaths.find(candidate => museSessionId(candidate) === entry.sessionId) ?? null;
      if (path) indexedPaths.set(transcriptCandidateKey(kind, entry.sessionId), path);
    }
  }

  // Fallback for the current non-claude harness: pre-PAN-3959 agents record
  // their current session in a side file (kimi-session-id, codex-thread-id,
  // the acp/pi session pointers) rather than in sessions.json, and the
  // per-entry formula guess above can point at a session id that never wrote
  // a real file. resolveAgentTranscriptCandidate's existence check already
  // falls through past a stale/guessed candidate to this one.
  const stateDerived: TranscriptCandidate[] = [];
  const currentKind = transcriptCandidateKind(currentHarness);
  if (currentKind !== 'claude') {
    const path = currentKind === 'codex' ? await resolveCodexRolloutPath(agentId, opts)
      : currentKind === 'pi' || currentKind === 'ohmypi' ? await resolvePiSessionPath(agentId, opts)
      : currentKind === 'acp' ? await resolveAcpTranscriptPath(agentId, opts)
      : currentKind === 'kimi' ? await resolveKimiWirePath(agentId, opts)
      : currentKind === 'muse' ? await resolveMuseSessionPath(agentId, opts.agentsDirOverride)
      : null;
    if (path) {
      const mtime = await stat(path).then(value => value.mtimeMs, () => null);
      if (index.resetAt === null || (mtime !== null && mtime >= index.resetAt)) {
        stateDerived.push({
          kind: currentKind,
          path,
          ...(recorded.model ? { model: recorded.model } : {}),
        });
      }
    }
  }

  return orderedTranscriptCandidates({ entries, currentHarness, indexedPaths, stateDerived });
}

export async function resolveAgentTranscriptCandidate(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
  candidates?: readonly TranscriptCandidate[],
): Promise<TranscriptCandidate | null> {
  for (const candidate of candidates ?? await listAgentTranscriptCandidates(agentId, workspacePath, opts)) {
    if (await pathExists(candidate.path)) {
      logTranscriptResolution(
        agentId,
        `resolved:${candidate.path}`,
        `resolved kind=${candidate.kind} path=${candidate.path}`,
        opts,
      );
      return candidate;
    }
  }
  return null;
}

export async function resolveJsonlPath(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const candidates = await listAgentTranscriptCandidates(agentId, workspacePath, opts);
  const resolved = await resolveAgentTranscriptCandidate(agentId, workspacePath, opts, candidates);
  if (resolved) return resolved.path;
  const checked = candidates.map(({ path }) => path).join(',');
  logTranscriptResolution(agentId, `missing:${checked}`, `failed checked=${checked}`, opts);
  return null;
}
