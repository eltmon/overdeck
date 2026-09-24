import { existsSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConversationResponse } from '@overdeck/contracts';
import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  getActivity,
  getAgentState,
} from '../../../../lib/agents.js';
import { capturePane } from '../../../../lib/tmux.js';
import { readAgentPaneText } from '../../../../lib/terminal-backends/agent-pane-io.js';
import { parseEntireConversation } from '../../services/conversation-service.js';
import { parsePiConversationMessages } from '../../services/pi-conversation-parser.js';
import { parseOhmypiConversationMessages } from '../../services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../../services/codex-conversation-parser.js';
import { parseAcpConversationMessages } from '../../services/acp-conversation-parser.js';
import { sharedTranscriptParser } from '../../services/shared-transcript-parser.js';
import {
  listAgentTranscriptCandidates,
} from '../../../../lib/agents/transcript-resolver.js';
import { isExternalAgentId, readExternalRegistration } from '../../../../lib/agents/external-registry.js';
import { checkTranscriptPath } from '../../../../lib/agents/external-paths.js';
import {
  isSafeSubagentId,
  listAgentSubagents,
  resolveAgentSubagentTranscript,
} from '../../services/agent-subagents.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  execAsync,
  getAgentWorkspace,
} from './shared.js';

// ─── Route: GET /api/agents/:id/output ───────────────────────────────────────

/** Seams for {@link readAgentOutput}. Production callers pass nothing. */
export interface AgentOutputDeps {
  /** The pane on the host's terminal backend; throws when it cannot be read. */
  readPane?: (agentId: string, lines: number) => Promise<string>;
  /** A pre-Herdr agent still running in its tmux session on a Herdr host. */
  readLegacyTmuxPane?: (agentId: string, lines: number) => Promise<string>;
  readRemoteState?: (agentId: string) => Promise<{ location?: string; vmName?: string } | null>;
  readRemoteOutput?: (agentId: string, vmName: string, lines: number) => Promise<string>;
  readSavedLog?: (agentId: string) => Promise<string | null>;
}

function agentStateDir(agentId: string): string {
  return join(homedir(), '.overdeck', 'agents', agentId);
}

async function readRemoteStateDefault(agentId: string): Promise<{ location?: string; vmName?: string } | null> {
  const remoteStateFile = join(agentStateDir(agentId), 'remote-state.json');
  if (!existsSync(remoteStateFile)) return null;
  try {
    return JSON.parse(await readFile(remoteStateFile, 'utf-8'));
  } catch {
    return null;
  }
}

async function readRemoteOutputDefault(agentId: string, vmName: string, lines: number): Promise<string> {
  const { getRemoteAgentOutput } = await import('../../../../lib/remote/remote-agents.js');
  return getRemoteAgentOutput(agentId, vmName, lines);
}

function isBlankOutput(text: string): boolean {
  return text.trim() === '' || text.trim() === 'Session not found';
}

/**
 * The recent terminal text of an agent, read through the host's terminal
 * backend: Herdr `pane.read`, or tmux `capture-pane`. It used to read tmux
 * alone, so a Herdr agent (the default backend) always came back empty. On a
 * Herdr host an agent launched before the move still runs in its tmux session,
 * so a Herdr miss tries tmux once. The saved `output.log` is the last fallback.
 */
export async function readAgentOutput(
  agentId: string,
  lines: number,
  deps: AgentOutputDeps = {},
): Promise<string> {
  const readPane = deps.readPane ?? ((id: string, n: number) => readAgentPaneText(id, n));
  const readLegacyTmuxPane = deps.readLegacyTmuxPane ?? capturePane;
  const readRemoteState = deps.readRemoteState ?? readRemoteStateDefault;
  const readRemoteOutput = deps.readRemoteOutput ?? readRemoteOutputDefault;
  const readSavedLog = deps.readSavedLog
    ?? ((id: string) => readFile(join(agentStateDir(id), 'output.log'), 'utf-8').catch(() => null));

  let output = '';
  const remote = await readRemoteState(agentId).catch(() => null);
  if (remote?.location === 'remote' && remote.vmName) {
    output = await readRemoteOutput(agentId, remote.vmName, lines).catch(() => '');
  } else {
    try {
      output = await readPane(agentId, lines);
    } catch {
      output = await readLegacyTmuxPane(agentId, lines).catch(() => '');
    }
  }

  if (isBlankOutput(output)) {
    const logContent = await readSavedLog(agentId).catch(() => null);
    output = logContent ? logContent.split('\n').slice(-lines).join('\n') : '';
  }
  return isBlankOutput(output) ? '' : output;
}

export const getAgentOutputRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/output',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const lines = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('lines') ?? '100') : '100';

    return yield* Effect.promise(async () => {
      const output = await readAgentOutput(id, parseInt(String(lines), 10) || 100).catch(() => '');
      return jsonResponse({ output });
    });
  })),
);

// ─── Route: GET /api/agents/:id/conversation ─────────────────────────────────

/**
 * The workspace transcript resolution keys on. An external agent (PAN-3920
 * W21) has no state.json and no Overdeck pane: its registration's cwd is the
 * workspace, and no tmux lookup is made for it.
 */
async function agentWorkspaceFor(id: string): Promise<string | null> {
  if (isExternalAgentId(id)) return (await readExternalRegistration(id))?.cwd ?? null;
  return getAgentWorkspace(id);
}

const EMPTY_CONVERSATION: ConversationResponse = { messages: [], workLog: [], streaming: false, totalCost: 0, byteOffset: 0 };

type AgentConversationResult =
  | { status: 200; body: ConversationResponse }
  | { status: 400; body: { error: string } }
  | { status: 404; body: { error: string; checked: string[] } }
  | { status: 500; body: { error: string } };

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function missingTranscript(id: string, checked: string[]): AgentConversationResult {
  return { status: 404, body: { error: `No transcript found for ${id}.`, checked } };
}

/**
 * Resolve and parse an agent's conversation JSONL file.
 * Exported for unit testing — the Effect route layer is not directly unit-testable.
 *
 * Dispatches on harness so Pi and Codex agents get their native parsers (PAN-2012).
 * Claude resolution follows the append-only session index, newest first.
 */
export async function buildAgentConversationResult(
  id: string,
  opts: { subagentId?: string } = {},
): Promise<AgentConversationResult> {
  if (opts.subagentId !== undefined && !isSafeSubagentId(opts.subagentId)) {
    return { status: 400, body: { error: 'subagentId must match ^[A-Za-z0-9_-]+$' } };
  }
  try {
    const workspace = await agentWorkspaceFor(id);
    if (opts.subagentId !== undefined) {
      // External agents have no subagents Overdeck reads (their files are another tool's).
      if (isExternalAgentId(id)) return { status: 404, body: { error: `No subagent ${opts.subagentId} found for ${id}.`, checked: [] } };
      return await buildAgentSubagentResult(id, workspace ?? '', opts.subagentId);
    }
    const candidates = await listAgentTranscriptCandidates(id, workspace ?? '');
    const checked = candidates.map(({ path }) => path);
    let selected: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (await pathExists(candidate.path)) { selected = candidate; break; }
    }
    if (!selected) return missingTranscript(id, checked);
    if (isExternalAgentId(id)) {
      // Another tool wrote this path: re-check it before reading (a regular
      // file under the transcript roots; never a FIFO, never a symlink escape).
      const safe = await checkTranscriptPath(selected.path);
      if (!safe.ok) return missingTranscript(id, checked);
      selected = { ...selected, path: safe.path };
    }

    const result = selected.kind === 'claude' ? await parseEntireConversation(selected.path)
      : selected.kind === 'pi' ? await parsePiConversationMessages(selected.path)
      : selected.kind === 'ohmypi' ? await parseOhmypiConversationMessages(selected.path)
      : selected.kind === 'codex' ? await parseCodexConversationMessages(selected.path)
      : selected.kind === 'acp' ? await parseAcpConversationMessages(selected.path)
      : await sharedTranscriptParser(selected.kind)(selected.path);

    if (selected.kind === 'acp') {
      return { status: 200, body: {
        ...result,
        messages: result.messages.map((message) => message.role === 'assistant'
          ? {
              ...message,
              completedAt: message.completedAt ?? message.createdAt,
              streaming: false,
            }
          : message),
        streaming: false,
      } };
    }
    return { status: 200, body: { ...result, streaming: false } };
  } catch (err) {
    console.error('[conversation] failed for', id, err);
    return { status: 500, body: { error: `Failed to load transcript for ${id}.` } };
  }
}

/** One subagent transcript of an agent (PAN-3920 W2, `?subagentId=`). */
async function buildAgentSubagentResult(
  id: string,
  workspace: string,
  subagentId: string,
): Promise<AgentConversationResult> {
  const resolved = await resolveAgentSubagentTranscript(id, workspace, subagentId);
  if (!resolved) {
    return { status: 404, body: { error: `No subagent ${subagentId} found for ${id}.`, checked: [] } };
  }
  const result = resolved.kind === 'claude'
    ? await parseEntireConversation(resolved.path)
    : await parseCodexConversationMessages(resolved.path);
  return { status: 200, body: { ...result, streaming: false } };
}

/** Compatibility helper retained for callers that only consume a transcript body. */
export async function buildConversationResponse(id: string): Promise<ConversationResponse> {
  const result = await buildAgentConversationResult(id);
  return result.status === 200 ? result.body : EMPTY_CONVERSATION;
}

export const getAgentConversationRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/conversation',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const subagentId = Option.isSome(urlOpt) ? urlOpt.value.searchParams.get('subagentId') : null;
    return yield* Effect.promise(async () => {
      const result = await buildAgentConversationResult(id, subagentId === null ? {} : { subagentId });
      return jsonResponse(result.body, { status: result.status });
    });
  })),
);

// ─── Route: GET /api/agents/:id/subagents ────────────────────────────────────

/** The agent's in-harness subagents (PAN-3920 W2). Transcript paths stay server-side. */
export async function buildAgentSubagentsResult(id: string): Promise<{ subagents: Array<Record<string, unknown>> }> {
  const workspace = await agentWorkspaceFor(id);
  if (isExternalAgentId(id)) return { subagents: [] };
  const subagents = await listAgentSubagents(id, workspace ?? '');
  return { subagents: subagents.map(({ transcriptPath: _path, ...summary }) => summary) };
}

export const getAgentSubagentsRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/subagents',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await buildAgentSubagentsResult(id));
      } catch (err) {
        console.error('[agent-subagents] failed for', id, err);
        return jsonResponse({ error: `Failed to list subagents for ${id}.` }, { status: 500 });
      }
    });
  })),
);

// ─── Route: GET /api/agents/:id/activity ─────────────────────────────────────

export const getAgentActivityRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/activity',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const limitStr = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('limit') ?? '100') : '100';
    const limit = parseInt(limitStr) || 100;

    const activity = getActivity(id, limit);
    return jsonResponse({ activity });
  })),
);

// ─── Route: GET /api/agents/:id/files ────────────────────────────────────────

export const getAgentFilesRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/files',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const agentState = getAgentState(id);
    if (!agentState?.workspace) {
      return jsonResponse({ files: [] });
    }
    const workspacePath = agentState.workspace;
    if (!existsSync(workspacePath)) {
      return jsonResponse({ files: [] });
    }
    const { stdout } = yield* Effect.promise(() => execAsync(
      'git diff --name-status HEAD 2>/dev/null || git status --porcelain 2>/dev/null || echo ""',
      { cwd: workspacePath, encoding: 'utf-8' }
    ));
    const files = stdout
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        const parts = l.trim().split(/\s+/);
        if (parts.length >= 2) {
          return { status: parts[0], path: parts[parts.length - 1] };
        }
        return { status: '?', path: l.trim() };
      })
      .filter(f => f.path);
    return jsonResponse({ files });
  })),
);

// ─── Route: GET /api/agents/:id/timeline ─────────────────────────────────────

export const getAgentTimelineRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/timeline',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const limitStr = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('limit') ?? '50') : '50';
    const limit = parseInt(limitStr) || 50;

    const activity = getActivity(id, limit);
    const agentState = getAgentState(id);
    const events = activity.map((a: any) => ({
      timestamp: a.timestamp || new Date().toISOString(),
      type: a.type || 'activity',
      message: a.message || a.content || '',
    }));
    if (agentState?.startedAt) {
      events.unshift({ timestamp: agentState.startedAt, type: 'started', message: 'Agent started' });
    }
    events.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return jsonResponse({ timeline: events.slice(0, limit) });
  })),
);
