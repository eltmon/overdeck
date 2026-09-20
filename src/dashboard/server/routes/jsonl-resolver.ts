/**
 * Harness-aware transcript resolution for dashboard agent routes and streams.
 * Candidate construction is shared with the synchronous agent adapter; this
 * module only supplies asynchronous filesystem materialization and existence.
 */
import { resolveMuseSessionPath } from '../../../lib/runtimes/muse-session.js';
import { access, readFile, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { getAgentRuntimeState, getAgentStateSync } from '../../../lib/agents.js';
import { encodeClaudeProjectDir, getOverdeckHome } from '../../../lib/paths.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';
import { kimiSessionsRoot } from '../../../lib/runtimes/kimi-code.js';
import {
  orderedTranscriptCandidates,
  latestSessionResetTime,
  parseSessionIndex,
  SESSION_RESET_MARKER,
  transcriptCandidateKey,
  transcriptCandidateKind,
  transcriptCandidateKinds,
  type SessionIndexEntry,
  type TranscriptCandidate,
} from '../../../lib/session-history.js';

export interface ResolveJsonlPathOptions {
  agentsDirOverride?: string;
  claudeProjectsDirOverride?: string;
  kimiHomeOverride?: string;
  workspaceOverride?: string;
  getRuntimeStateAsync?: (agentId: string) => Promise<{ claudeSessionId?: string } | null>;
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
  const logger = opts.logDiagnostic
    ?? (opts.agentsDirOverride ? undefined : logAgentLifecycleSync);
  logger?.(agentId, `transcript resolution: ${message}`);
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

async function readOptional(p: string): Promise<string | null> {
  return readFile(p, 'utf-8').catch(() => null);
}

async function readIndexedSessionEntries(agentDir: string): Promise<{ entries: SessionIndexEntry[]; exists: boolean; resetAt: number | null }> {
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
  const candidates = [
    join(home, 'conversations', tmuxSession, 'launcher.sh'),
    join(home, 'agents', tmuxSession, 'launcher.sh'),
  ];
  for (const path of candidates) {
    const text = await readOptional(path);
    if (!text) continue;
    const match = LAUNCHER_SESSION_ID_RE.exec(text) ?? LAUNCHER_RESUME_RE.exec(text);
    if (match) return match[1]!;
  }
  return null;
}

async function readRecordedState(
  agentId: string,
  opts: ResolveJsonlPathOptions,
): Promise<{ harness: string | null; workspace?: string; sessionId?: string }> {
  if (opts.agentsDirOverride) {
    try {
      const raw = await readFile(join(opts.agentsDirOverride, agentId, 'state.json'), 'utf8');
      const s = JSON.parse(raw) as { harness?: unknown; workspace?: unknown; sessionId?: unknown };
      return {
        harness: typeof s.harness === 'string' ? s.harness : null,
        workspace: typeof s.workspace === 'string' ? s.workspace : undefined,
        sessionId: typeof s.sessionId === 'string' ? s.sessionId : undefined,
      };
    } catch {
      return { harness: null };
    }
  }
  const st = getAgentStateSync(agentId);
  return { harness: st?.harness ?? null, workspace: st?.workspace, sessionId: st?.sessionId };
}

export async function resolveCodexRolloutPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);
  const codexHome = join(agentDir, 'codex-home');
  if (!(await pathExists(codexHome))) return null;

  const { findRolloutPath, findLatestRollout } = await import('../../../lib/runtimes/codex.js');

  const threadId = (await readOptional(join(agentDir, 'codex-thread-id')))?.trim();
  if (threadId) {
    const rollout = findRolloutPath(codexHome, threadId);
    if (rollout) return rollout;
  }
  return findLatestRollout(codexHome);
}

export async function resolveAcpTranscriptPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const transcriptPath = join(agentsRoot, agentId, 'acp-session.jsonl');
  return await pathExists(transcriptPath) ? transcriptPath : null;
}

export async function resolveKimiWirePath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const workspace = opts.workspaceOverride ?? (await readRecordedState(agentId, opts)).workspace;
  if (!workspace) return null;

  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const sessionId = (await readOptional(join(agentsRoot, agentId, 'kimi-session-id')))?.trim() || null;
  const kimiHome = opts.kimiHomeOverride ?? join(homedir(), '.kimi-code');

  const { findKimiWirePathAsync } = await import('../../../lib/runtimes/kimi-code.js');
  return findKimiWirePathAsync(kimiHome, workspace, sessionId);
}

export async function resolvePiSessionPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);
  const NON_TRANSCRIPT = new Set([
    'acp-session.jsonl',
    'cost-events.jsonl',
    'activity.jsonl',
    'pending-events.jsonl',
  ]);
  let best: { path: string; mtime: number } | null = null;
  for (const dir of [join(agentDir, 'sessions'), agentDir]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl') || NON_TRANSCRIPT.has(name)) continue;
      const p = join(dir, name);
      try {
        const m = (await stat(p)).mtimeMs;
        if (!best || m > best.mtime) best = { path: p, mtime: m };
      } catch { /* unreadable entry — skip */ }
    }
  }
  return best?.path ?? null;
}

async function findCodexRolloutForSession(dir: string, sessionId: string): Promise<string | null> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findCodexRolloutForSession(path, sessionId);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(`-${sessionId}.jsonl`)) {
      return path;
    }
  }
  return null;
}

async function findPiTranscriptForSession(agentDir: string, sessionId: string): Promise<string | null> {
  for (const dir of [join(agentDir, 'sessions'), agentDir]) {
    let names: string[];
    try { names = await readdir(dir); } catch { continue; }
    const name = names.find((entry) => entry.endsWith(`_${sessionId}.jsonl`) || entry === `${sessionId}.jsonl`);
    if (name) return join(dir, name);
  }
  return null;
}

export async function listAgentTranscriptCandidates(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<TranscriptCandidate[]> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);
  if (await pathExists(join(agentDir, SESSION_RESET_MARKER))) return [];
  const recorded = await readRecordedState(agentId, opts);
  const currentHarness = recorded.harness;
  const effectiveWorkspace = recorded.workspace ?? workspacePath;
  const projectsRoot = opts.claudeProjectsDirOverride ?? join(homedir(), '.claude', 'projects');
  const projectDir = join(projectsRoot, encodeClaudeProjectDir(effectiveWorkspace));
  const kimiHome = opts.kimiHomeOverride ?? join(homedir(), '.kimi-code');
  const index = await readIndexedSessionEntries(agentDir);
  const entries = [...index.entries];
  if (!index.exists) {
    const legacy = (await readOptional(join(agentDir, 'session.id')))?.trim();
    if (legacy) entries.push({ sessionId: legacy, at: '', source: 'legacy-pointer' });
  }

  const indexedPaths = new Map<string, string>();
  for (const entry of entries) {
    for (const kind of transcriptCandidateKinds(entry.harness, currentHarness)) {
      let path: string | null = null;
      if (kind === 'claude') path = join(projectDir, `${entry.sessionId}.jsonl`);
      else if (kind === 'kimi') path = join(kimiSessionsRoot(kimiHome, effectiveWorkspace), entry.sessionId, 'agents', 'main', 'wire.jsonl');
      else if (kind === 'codex') {
        const homes = (await readdir(agentDir, { withFileTypes: true }).catch(() => []))
          .filter((home) => home.isDirectory() && home.name.startsWith('codex-home'))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const home of homes) {
          path = await findCodexRolloutForSession(join(agentDir, home.name, 'sessions'), entry.sessionId);
          if (path) break;
        }
      } else if (kind === 'pi' || kind === 'ohmypi') {
        path = await findPiTranscriptForSession(agentDir, entry.sessionId);
      } else if (kind === 'acp') path = join(agentDir, 'acp-session.jsonl');
      else if (kind === 'muse') path = join(agentDir, 'muse-session.jsonl');
      if (path) indexedPaths.set(transcriptCandidateKey(kind, entry.sessionId), path);
    }
  }

  let launcherPinned: TranscriptCandidate | null = null;
  if (transcriptCandidateKind(currentHarness) === 'claude') {
    const launcher = await readOptional(join(agentDir, 'launcher.sh'));
    const sessionId = launcher
      ? (LAUNCHER_SESSION_ID_RE.exec(launcher) ?? LAUNCHER_RESUME_RE.exec(launcher))?.[1]
      : undefined;
    if (sessionId) launcherPinned = { kind: 'claude', path: join(projectDir, `${sessionId}.jsonl`) };
  }

  const stateDerived: TranscriptCandidate[] = [];
  const currentKind = transcriptCandidateKind(currentHarness);
  if (currentKind === 'claude') {
    try {
      const lookup = opts.getRuntimeStateAsync ?? ((id: string) => Effect.runPromise(getAgentRuntimeState(id)));
      const runtimeId = (await lookup(agentId))?.claudeSessionId?.trim();
      if (runtimeId) stateDerived.push({ kind: 'claude', path: join(projectDir, `${runtimeId}.jsonl`) });
    } catch { /* optional runtime mirror */ }
    if (recorded.sessionId?.trim()) stateDerived.push({ kind: 'claude', path: join(projectDir, `${recorded.sessionId.trim()}.jsonl`) });
  } else {
    const path = currentKind === 'codex' ? await resolveCodexRolloutPath(agentId, opts)
      : currentKind === 'pi' || currentKind === 'ohmypi' ? await resolvePiSessionPath(agentId, opts)
      : currentKind === 'acp' ? await resolveAcpTranscriptPath(agentId, opts)
      : currentKind === 'kimi' ? await resolveKimiWirePath(agentId, opts)
      : currentKind === 'muse' ? await resolveMuseSessionPath(agentId, opts.agentsDirOverride)
      : null;
    if (path) {
      const mtime = await stat(path).then((value) => value.mtimeMs, () => null);
      if (index.resetAt === null || (mtime !== null && mtime >= index.resetAt)) {
        stateDerived.push({ kind: currentKind, path });
      }
    }
  }

  return orderedTranscriptCandidates({
    entries,
    currentHarness,
    indexedPaths,
    launcherPinned,
    stateDerived,
  });
}

export async function resolveJsonlPath(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const candidates = await listAgentTranscriptCandidates(agentId, workspacePath, opts);
  const resolved = await resolveAgentTranscriptCandidate(agentId, workspacePath, opts, candidates);
  if (resolved) return resolved.path;
  logTranscriptResolution(agentId, `missing:${candidates.map(({ path }) => path).join(',')}`, `failed checked=${candidates.map(({ path }) => path).join(',')}`, opts);
  return null;
}

export async function resolveAgentTranscriptCandidate(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
  candidates?: readonly TranscriptCandidate[],
): Promise<TranscriptCandidate | null> {
  for (const candidate of candidates ?? await listAgentTranscriptCandidates(agentId, workspacePath, opts)) {
    if (await pathExists(candidate.path)) {
      logTranscriptResolution(agentId, `resolved:${candidate.path}`, `resolved kind=${candidate.kind} path=${candidate.path}`, opts);
      return candidate;
    }
  }
  return null;
}
