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
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  listConversations,
  getConversationByName,
  createConversation,
  markConversationEnded,
  markConversationActive,
  updateLastAttached,
} from '../../../lib/database/conversations-db.js';

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
  mkdirSync(stateDir, { recursive: true });

  const launcherScript = join(stateDir, 'launcher.sh');
  const envExports = [
    `export TERM=xterm-256color`,
    `export COLORTERM=truecolor`,
    `export LANG=C.UTF-8`,
    `export LC_ALL=C.UTF-8`,
    ...(issueId ? [`export PANOPTICON_ISSUE_ID="${issueId}"`] : []),
  ].join('\n');

  writeFileSync(launcherScript, `#!/bin/bash
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

// ─── Route: GET /api/conversations ───────────────────────────────────────────

const getConversationsRoute = HttpRouter.add(
  'GET',
  '/api/conversations',
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const conversations = listConversations();

        // Enrich with live tmux status
        const enriched = await Promise.all(
          conversations.map(async (conv) => {
            const sessionAlive = await tmuxSessionExists(conv.tmuxSession);
            return { ...conv, sessionAlive };
          }),
        );

        return jsonResponse(enriched);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to list conversations: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/conversations ──────────────────────────────────────────

const postConversationRoute = HttpRouter.add(
  'POST',
  '/api/conversations',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    return yield* Effect.tryPromise({
      try: async () => {
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
          return jsonResponse(
            { error: `Conversation "${name}" already exists` },
            { status: 409 },
          );
        }

        // Persist to DB first so the client gets a response quickly
        const conv = createConversation(name, tmuxSession, cwd, issueId);

        // Spawn tmux session in background (don't await — let ws-terminal attach when ready)
        spawnConversationSession(tmuxSession, cwd, issueId).catch((err: unknown) => {
          console.error(`[conversations] Failed to spawn session ${tmuxSession}:`, err);
        });

        return jsonResponse(conv, { status: 201 });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to create conversation: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: DELETE /api/conversations/:name ───────────────────────────────────

const deleteConversationRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.tryPromise({
      try: async () => {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        // Kill tmux session
        await execAsync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' });

        // Mark ended in DB
        markConversationEnded(name);

        return jsonResponse({ success: true });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to delete conversation: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/conversations/:name/resume ─────────────────────────────

const postConversationResumeRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/resume',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.tryPromise({
      try: async () => {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        const sessionAlive = await tmuxSessionExists(conv.tmuxSession);

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
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to resume conversation: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const conversationsRouteLayer = Layer.mergeAll(
  getConversationsRoute,
  postConversationRoute,
  deleteConversationRoute,
  postConversationResumeRoute,
);

export default conversationsRouteLayer;
