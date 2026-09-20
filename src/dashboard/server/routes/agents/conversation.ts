import { existsSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConversationResponse } from '@overdeck/contracts';
import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getOverdeckHome } from '../../../../lib/paths.js';
import {
  getActivity,
  getAgentState,
} from '../../../../lib/agents.js';
import { capturePane } from '../../../../lib/tmux.js';
import { parseEntireConversation } from '../../services/conversation-service.js';
import { parsePiConversationMessages } from '../../services/pi-conversation-parser.js';
import { parseOhmypiConversationMessages } from '../../services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../../services/codex-conversation-parser.js';
import { parseAcpConversationMessages } from '../../services/acp-conversation-parser.js';
import {
  listClaudeTranscriptPaths,
  resolvePiSessionPath,
  resolveCodexRolloutPath,
  resolveAcpTranscriptPath,
  resolveAgentHarness,
  resolveJsonlPath,
} from '../jsonl-resolver.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  execAsync,
  getAgentWorkspace,
} from './shared.js';

// ─── Route: GET /api/agents/:id/output ───────────────────────────────────────

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
        try {
          const agentStateDir = join(homedir(), '.overdeck', 'agents', id);
          const remoteStateFile = join(agentStateDir, 'remote-state.json');
          let isRemote = false;
          let vmName = '';

          if (existsSync(remoteStateFile)) {
            try {
              const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
              if (state.location === 'remote' && state.vmName) {
                isRemote = true;
                vmName = state.vmName;
              }
            } catch {}
          }

          let stdout: string;
          if (isRemote && vmName) {
            const { getRemoteAgentOutput } = await import('../../../../lib/remote/remote-agents.js');
            stdout = await getRemoteAgentOutput(id, vmName, parseInt(String(lines), 10) || 100);
          } else {
            stdout = await Effect.runPromise(capturePane(id, parseInt(String(lines), 10) || 100));
          }

          if (!stdout || stdout.trim() === '' || stdout.trim() === 'Session not found') {
            const savedLog = join(agentStateDir, 'output.log');
            const logContent = await readFile(savedLog, 'utf-8').catch(() => null);
            if (logContent) {
              const logLines = logContent.split('\n');
              const numLines = parseInt(String(lines), 10) || 100;
              stdout = logLines.slice(-numLines).join('\n');
            }
          }

          if (stdout?.trim() === 'Session not found') {
            stdout = '';
          }

          return jsonResponse({ output: stdout });
        } catch (error: unknown) {
          // Try saved log on error
          try {
            const agentStateDir = join(homedir(), '.overdeck', 'agents', id);
            const savedLog = join(agentStateDir, 'output.log');
            const logContent = await readFile(savedLog, 'utf-8').catch(() => null);
            if (logContent) return jsonResponse({ output: logContent });
          } catch {}
          return jsonResponse({ output: '' });
        }
      })
  })),
);

// ─── Route: GET /api/agents/:id/conversation ─────────────────────────────────

const EMPTY_CONVERSATION: ConversationResponse = { messages: [], workLog: [], streaming: false, totalCost: 0, byteOffset: 0 };

type AgentConversationResult =
  | { status: 200; body: ConversationResponse }
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
export async function buildAgentConversationResult(id: string): Promise<AgentConversationResult> {
  const checked: string[] = [];
  try {
    const harness = await resolveAgentHarness(id);
    const agentDir = join(getOverdeckHome(), 'agents', id);

    if (harness === 'ohmypi') {
      const sessionFile = await resolvePiSessionPath(id);
      if (sessionFile) checked.push(sessionFile);
      checked.push(join(agentDir, 'sessions', '**', '*.jsonl'), join(agentDir, '*.jsonl'));
      if (!sessionFile || !(await pathExists(sessionFile))) return missingTranscript(id, checked);
      const result = await parseOhmypiConversationMessages(sessionFile);
      return { status: 200, body: { ...result, streaming: false } };
    }

    if (harness === 'pi') {
      const sessionFile = await resolvePiSessionPath(id);
      if (sessionFile) checked.push(sessionFile);
      checked.push(join(agentDir, 'sessions', '**', '*.jsonl'), join(agentDir, '*.jsonl'));
      if (!sessionFile || !(await pathExists(sessionFile))) return missingTranscript(id, checked);
      const result = await parsePiConversationMessages(sessionFile);
      return { status: 200, body: { ...result, streaming: false } };
    }

    if (harness === 'codex') {
      const sessionFile = await resolveCodexRolloutPath(id);
      if (sessionFile) checked.push(sessionFile);
      checked.push(join(agentDir, 'codex-home*', 'sessions', '**', 'rollout-*.jsonl'));
      if (!sessionFile || !(await pathExists(sessionFile))) return missingTranscript(id, checked);
      const result = await parseCodexConversationMessages(sessionFile);
      return { status: 200, body: { ...result, streaming: false } };
    }

    if (harness === 'acp' || harness === 'opencode') {
      const sessionFile = await resolveAcpTranscriptPath(id);
      if (sessionFile) checked.push(sessionFile);
      checked.push(join(agentDir, 'acp-session.jsonl'));
      if (!sessionFile || !(await pathExists(sessionFile))) return missingTranscript(id, checked);
      const result = await parseAcpConversationMessages(sessionFile);
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

    // claude-code (default): append-only index first; mutable compatibility
    // pointers are considered by the shared resolver only when no index exists.
    checked.push(
      join(agentDir, 'sessions.json'),
      join(agentDir, 'session.id'),
      join(agentDir, 'runtime.json'),
      join(agentDir, 'state.json'),
    );
    const workspace = await Effect.runPromise(getAgentWorkspace(id));
    let jsonlPath: string | null = null;
    if (workspace) {
      for (const candidate of await listClaudeTranscriptPaths(id, workspace)) {
        checked.push(candidate);
      }
      jsonlPath = await resolveJsonlPath(id, workspace);
      if (jsonlPath && !checked.includes(jsonlPath)) checked.push(jsonlPath);
    } else {
      checked.push(join(agentDir, 'state.json (workspace missing)'));
    }
    if (!jsonlPath) return missingTranscript(id, checked);
    // parseEntireConversation, not parseConversationMessages: a single parse caps
    // at MAX_READ_BYTES (10 MB) and would drop the most recent turns of a larger
    // transcript (PAN-1989). This one-shot endpoint must return the whole file.
    const result = await parseEntireConversation(jsonlPath);
    // Force streaming: false — tmux session is dead, any "streaming" state is stale
    return { status: 200, body: { ...result, streaming: false } };
  } catch (err) {
    console.error('[conversation] failed for', id, err);
    return { status: 500, body: { error: `Failed to load transcript for ${id}.` } };
  }
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
    return yield* Effect.promise(async () => {
      const result = await buildAgentConversationResult(id);
      return jsonResponse(result.body, { status: result.status });
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

    const agentState = yield* getAgentState(id);
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
    const agentState = yield* getAgentState(id);
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
