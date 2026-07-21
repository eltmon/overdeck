import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConversationResponse } from '@overdeck/contracts';
import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { encodeClaudeProjectDir } from '../../../../lib/paths.js';
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
  readLauncherPinnedSessionId,
  resolvePiSessionPath,
  resolveCodexRolloutPath,
  resolveAcpTranscriptPath,
  resolveAgentHarness,
} from '../jsonl-resolver.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  execAsync,
  getAgentJsonlPath,
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

/**
 * Resolve and parse an agent's conversation JSONL file.
 * Exported for unit testing — the Effect route layer is not directly unit-testable.
 *
 * Dispatches on harness so Pi and Codex agents get their native parsers (PAN-2012).
 * For claude-code agents, tries the launcher-pinned --session-id first (the exact
 * session the Terminal tab attaches to) before falling back to mtime-based pick
 * (PAN-2011). This makes the Conversation tab match the Terminal tab by construction.
 */
export async function buildConversationResponse(id: string): Promise<ConversationResponse> {
  try {
    const harness = await resolveAgentHarness(id);

    if (harness === 'ohmypi') {
      const sessionFile = await resolvePiSessionPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parseOhmypiConversationMessages(sessionFile);
      return { ...result, streaming: false };
    }

    if (harness === 'pi') {
      const sessionFile = await resolvePiSessionPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parsePiConversationMessages(sessionFile);
      return { ...result, streaming: false };
    }

    if (harness === 'codex') {
      const sessionFile = await resolveCodexRolloutPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parseCodexConversationMessages(sessionFile);
      return { ...result, streaming: false };
    }

    if (harness === 'acp') {
      const sessionFile = await resolveAcpTranscriptPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parseAcpConversationMessages(sessionFile);
      return {
        ...result,
        messages: result.messages.map((message) => message.role === 'assistant'
          ? {
              ...message,
              completedAt: message.completedAt ?? message.createdAt,
              streaming: false,
            }
          : message),
        streaming: false,
      };
    }

    // claude-code (default): try launcher-pinned session ID first (ground truth),
    // then fall back to mtime-based pick.
    let jsonlPath: string | null = null;
    const pinnedSessionId = await readLauncherPinnedSessionId(id);
    if (pinnedSessionId) {
      const workspace = await Effect.runPromise(getAgentWorkspace(id));
      if (workspace) {
        const candidate = join(
          homedir(), '.claude', 'projects',
          encodeClaudeProjectDir(workspace),
          `${pinnedSessionId}.jsonl`,
        );
        if (existsSync(candidate)) jsonlPath = candidate;
      }
    }
    if (!jsonlPath) {
      jsonlPath = await Effect.runPromise(getAgentJsonlPath(id));
    }

    if (!jsonlPath || !existsSync(jsonlPath)) return EMPTY_CONVERSATION;
    // parseEntireConversation, not parseConversationMessages: a single parse caps
    // at MAX_READ_BYTES (10 MB) and would drop the most recent turns of a larger
    // transcript (PAN-1989). This one-shot endpoint must return the whole file.
    const result = await parseEntireConversation(jsonlPath);
    // Force streaming: false — tmux session is dead, any "streaming" state is stale
    return { ...result, streaming: false };
  } catch (err) {
    console.error('[conversation] failed for', id, err);
    return EMPTY_CONVERSATION;
  }
}

export const getAgentConversationRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/conversation',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return yield* Effect.promise(async () => jsonResponse(await buildConversationResponse(id)));
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
