import { jsonResponse } from "../http-helpers.js";
/**
 * Conversations route module — Effect HttpRouter.Layer (PAN-416)
 *
 * Implements conversation session management endpoints:
 *   GET    /api/conversations                — list all conversations
 *   POST   /api/conversations                — spawn a new conversation
 *   DELETE /api/conversations/:name          — kill session, mark ended
 *   POST   /api/conversations/:name/resume   — reattach or respawn
 */

import { exec } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  listConversations,
  getConversationByName,
  createConversation,
  markConversationEnded,
  markConversationActive,
  updateLastAttached,
  updateSessionFile,
  updateConversationTitle,
} from '../../../lib/database/conversations-db.js';
import { sendKeysAsync } from '../../../lib/tmux.js';
import {
  snapshotSessionFiles,
  discoverSessionFile,
  parseConversationMessages,
} from '../services/conversation-service.js';
import { httpHandler } from './http-handler.js';

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

/** Generate a default conversation name, e.g. conv-20260404-1 */
function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `conv-${date}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

/** Sanitize a user-provided name to be safe for tmux session names */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}

/** Check if a tmux session exists (async, non-blocking) */
async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a new tmux session running claude.
 * Uses a minimal launcher script for proper terminal env setup.
 */
async function spawnConversationSession(
  tmuxSession: string,
  cwd: string,
  issueId?: string,
): Promise<void> {
  const stateDir = join(homedir(), '.panopticon', 'conversations', tmuxSession);
  await mkdir(stateDir, { recursive: true });

  const launcherScript = join(stateDir, 'launcher.sh');
  const envExports = [
    `export TERM=xterm-256color`,
    `export COLORTERM=truecolor`,
    `export LANG=C.UTF-8`,
    `export LC_ALL=C.UTF-8`,
    ...(issueId ? [`export PANOPTICON_ISSUE_ID="${issueId}"`] : []),
  ].join('\n');

  await writeFile(launcherScript, `#!/bin/bash
${envExports}
cd "${cwd}"
trap '' HUP
claude --dangerously-skip-permissions
echo ""
echo "Conversation session ended. Close this panel or click Resume to start a new session."
while true; do sleep 60; done
`, { mode: 0o755 });

  // Kill any stale session with the same name
  await execAsync(`tmux kill-session -t ${tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' });

  // Spawn the session
  await execAsync(
    `TERM=xterm-256color tmux new-session -d -s ${tmuxSession} "bash '${launcherScript}'"`,
    { encoding: 'utf-8' },
  );

  // Keep session alive when clients disconnect
  await execAsync(`tmux set-option -t ${tmuxSession} destroy-unattached off 2>/dev/null || true`, { encoding: 'utf-8' });
  await execAsync(`tmux set-option -t ${tmuxSession} remain-on-exit on 2>/dev/null || true`, { encoding: 'utf-8' });
}

/**
 * Discover the session file for a conversation, blocking until found.
 * Takes a snapshot of existing files (captured BEFORE spawn) and waits
 * for a NEW file to appear. Returns the path or null on timeout.
 */
async function awaitSessionFile(
  name: string,
  cwd: string,
  existingFiles: Set<string>,
): Promise<string | null> {
  const path = await discoverSessionFile(cwd, existingFiles);
  if (path) {
    updateSessionFile(name, path);
    console.log(`[conversations] Discovered session file for "${name}": ${path}`);
  } else {
    console.warn(`[conversations] Session file discovery timed out for "${name}"`);
  }
  return path;
}

// ─── Route: GET /api/conversations ───────────────────────────────────────────

const getConversationsRoute = HttpRouter.add(
  'GET',
  '/api/conversations',
  httpHandler(Effect.gen(function* () {
    const conversations = listConversations();

    // Enrich with live tmux status
    // Grace period: treat recently-created active conversations as alive (tmux may not have
    // started yet — spawn is async). After 30s we fall back to the actual tmux check.
    const SPAWN_GRACE_MS = 30_000;
    const enriched = yield* Effect.promise(() =>
      Promise.all(
        conversations.map(async (conv) => {
          const withinGrace =
            conv.status === 'active' &&
            !conv.endedAt &&
            Date.now() - new Date(conv.createdAt).getTime() < SPAWN_GRACE_MS;
          const sessionAlive = withinGrace || (await tmuxSessionExists(conv.tmuxSession));
          return { ...conv, sessionAlive };
        }),
      )
    );

    return jsonResponse(enriched);
  })),
);

// ─── Route: POST /api/conversations ──────────────────────────────────────────

const postConversationRoute = HttpRouter.add(
  'POST',
  '/api/conversations',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;

    const rawName = typeof body['name'] === 'string' && body['name'].trim()
      ? body['name'].trim()
      : generateConversationName();
    const name = sanitizeName(rawName);
    const issueId = typeof body['issueId'] === 'string' ? body['issueId'] : undefined;
    const cwd = join(homedir(), 'Projects');
    const tmuxSession = `conv-${name}`;

    // Prevent duplicate names
    const existing = getConversationByName(name);
    if (existing) {
      return jsonResponse({ error: `Conversation "${name}" already exists` }, { status: 409 });
    }

    // Persist to DB
    const conv = createConversation(name, tmuxSession, cwd, issueId);

    // Snapshot existing JSONL files BEFORE spawning so we can detect the new one
    const existingFiles = yield* Effect.promise(() => snapshotSessionFiles(cwd));

    // Spawn tmux session (await so it's ready)
    yield* Effect.tryPromise({
      try: () => spawnConversationSession(tmuxSession, cwd, issueId),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    // Block until we discover the new session file (up to 60s)
    const sessionFile = yield* Effect.promise(() => awaitSessionFile(name, cwd, existingFiles));

    return jsonResponse({ ...conv, sessionFile }, { status: 201 });
  })),
);

// ─── Route: DELETE /api/conversations/:name ───────────────────────────────────

const deleteConversationRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';

    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }

    // Kill tmux session
    yield* Effect.promise(() =>
      execAsync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' })
    );

    // Mark ended in DB
    markConversationEnded(name);

    return jsonResponse({ success: true });
  })),
);

// ─── Route: POST /api/conversations/:name/resume ─────────────────────────────

const postConversationResumeRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/resume',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';

    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }

    const sessionAlive = yield* Effect.promise(() => tmuxSessionExists(conv.tmuxSession));

    if (sessionAlive) {
      // Reattach: just update last_attached_at and mark active
      updateLastAttached(name);
      markConversationActive(name);
      return jsonResponse({ ...conv, status: 'active', reattached: true });
    }

    // Respawn: create a new tmux session with the same name
    spawnConversationSession(conv.tmuxSession, conv.cwd, conv.issueId ?? undefined).catch(
      (err: unknown) => {
        console.error(`[conversations] Failed to respawn session ${conv.tmuxSession}:`, err);
      },
    );

    markConversationActive(name);
    return jsonResponse({ ...conv, status: 'active', reattached: false });
  })),
);

// ─── Route: GET /api/conversations/:name/messages ────────────────────────────

const getConversationMessagesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/messages',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';

    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }

    // session_file is null until discovery completes after Claude Code starts
    if (!conv.sessionFile) {
      return jsonResponse({ discovering: true, messages: [], workLog: [], streaming: false });
    }

    const result = yield* Effect.tryPromise({
      try: () => parseConversationMessages(conv.sessionFile!, 0),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    return jsonResponse({
      messages: result.messages,
      workLog: result.workLog,
      streaming: result.streaming,
    });
  })),
);

// ─── Route: POST /api/conversations/:name/message ────────────────────────────

const postConversationMessageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/message',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;

    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }

    const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
    if (!message) {
      return jsonResponse({ error: 'Message is required' }, { status: 400 });
    }

    // Deliver via tmux load-buffer + paste-buffer (reliable delivery pattern)
    yield* Effect.tryPromise({
      try: () => sendKeysAsync(conv.tmuxSession, message, 'conversation-message'),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    return jsonResponse({ ok: true });
  })),
);

// ─── Route: PATCH /api/conversations/:name ────────────────────────────────────

const patchConversationRoute = HttpRouter.add(
  'PATCH',
  '/api/conversations/:name',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const req = yield* HttpServerRequest.HttpServerRequest;

    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }

    const body = yield* Effect.tryPromise({
      try: () => req.json as Promise<{ title?: string }>,
      catch: () => ({} as { title?: string }),
    });

    if (typeof body.title === 'string' && body.title.trim()) {
      updateConversationTitle(name, body.title.trim());
    }

    return jsonResponse({ success: true });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const conversationsRouteLayer = Layer.mergeAll(
  getConversationsRoute,
  postConversationRoute,
  patchConversationRoute,
  deleteConversationRoute,
  postConversationResumeRoute,
  getConversationMessagesRoute,
  postConversationMessageRoute,
);

export default conversationsRouteLayer;
