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
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
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
  updateSessionFile,
  updateConversationTitle,
  updateConversationCost,
  updateConversationModel,
  archiveConversation,
  canReplaceTitle,
} from '../../../lib/database/conversations-db.js';
import { sendKeysAsync } from '../../../lib/tmux.js';
import { getProviderForModel, getProviderEnv } from '../../../lib/providers.js';
import { loadConfig as loadYamlConfig } from '../../../lib/config-yaml.js';
import {
  parseConversationMessages,
  parseFromLastCompactBoundary,
} from '../services/conversation-service.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';

const execAsync = promisify(exec);

/**
 * Wait for Claude Code to show its input prompt (❯) in the tmux pane.
 * Polls every 500ms for up to 30 seconds. Claude Code takes a few seconds to start.
 */
async function waitForClaudeReady(tmuxSession: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -t ${tmuxSession} -p 2>/dev/null`,
        { encoding: 'utf-8' },
      );
      // Claude Code shows ❯ when ready for input
      if (stdout.includes('❯')) {
        console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
        return;
      }
    } catch {
      // Session might not exist yet
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  console.warn(`[conversations] Timed out waiting for Claude Code prompt in ${tmuxSession}`);
}

/** Compute the deterministic JSONL session file path from cwd + session UUID. */
function sessionFilePath(cwd: string, sessionId: string): string {
  const encodedCwd = encodeClaudeProjectDir(cwd);
  return join(homedir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
}

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

/** Generate a default conversation name, e.g. 20260404-1234 */
function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${Math.floor(Math.random() * 9000 + 1000)}`;
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
 * Extract the model from a Claude Code JSONL session file by reading
 * until the first assistant message with a model field.
 * Reads line-by-line to avoid loading the entire file into memory.
 */
async function extractModelFromSessionFile(sessionFile: string): Promise<string | null> {
  try {
    if (!existsSync(sessionFile)) return null;
    const stream = createReadStream(sessionFile, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (entry.type === 'assistant' && entry.message?.model) {
          return entry.message.model as string;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  } catch {
    // Corrupt or unreadable file — skip
  }
  return null;
}

/**
 * Backfill model column for existing conversations that have a session file
 * but no model stored. Runs once on server startup (async, non-blocking).
 */
async function backfillConversationModels(): Promise<void> {
  const convs = listConversations();
  let backfilled = 0;
  for (const conv of convs) {
    if (conv.model || !conv.sessionFile) continue;
    const model = await extractModelFromSessionFile(conv.sessionFile);
    if (model) {
      updateConversationModel(conv.name, model);
      backfilled++;
    }
  }
  if (backfilled > 0) {
    console.log(`[conversations] Backfilled model for ${backfilled} conversation(s)`);
  }
}

// Fire-and-forget backfill on module load
void backfillConversationModels().catch((err: unknown) => {
  console.error('[conversations] Model backfill failed:', err);
});

/**
 * Spawn a new tmux session running claude.
 * Uses a minimal launcher script for proper terminal env setup.
 * Accepts a claudeSessionId to deterministically control the JSONL file path.
 */
async function spawnConversationSession(
  tmuxSession: string,
  cwd: string,
  claudeSessionId: string,
  model?: string,
  effort?: string,
  issueId?: string,
  resume = false,
): Promise<void> {
  const stateDir = join(homedir(), '.panopticon', 'conversations', tmuxSession);
  await mkdir(stateDir, { recursive: true });

  const launcherScript = join(stateDir, 'launcher.sh');

  // Detect OpenRouter model and inject provider-specific env overrides
  const providerEnvExports: string[] = [];
  if (model) {
    const provider = getProviderForModel(model);
    if (provider.name !== 'anthropic') {
      const { config } = loadYamlConfig();
      const apiKey = config.apiKeys[provider.name as keyof typeof config.apiKeys];
      if (apiKey) {
        const providerEnv = getProviderEnv(provider, apiKey);
        for (const [key, val] of Object.entries(providerEnv)) {
          providerEnvExports.push(`export ${key}="${val}"`);
        }
      } else {
        throw new Error(`No API key configured for ${provider.displayName}. Configure it in Settings before using model "${model}".`);
      }
    }
  }

  const envExports = [
    `export TERM=xterm-256color`,
    `export COLORTERM=truecolor`,
    `export LANG=C.UTF-8`,
    `export LC_ALL=C.UTF-8`,
    ...(issueId ? [`export PANOPTICON_ISSUE_ID="${issueId}"`] : []),
    ...providerEnvExports,
  ].join('\n');

  const claudeArgs = [
    '--dangerously-skip-permissions',
    resume ? `--resume "${claudeSessionId}"` : `--session-id "${claudeSessionId}"`,
    ...(model ? [`--model "${model}"`] : []),
    ...(effort ? [`--effort "${effort}"`] : []),
  ].join(' ');

  await writeFile(launcherScript, `#!/bin/bash
${envExports}
cd "${cwd}"
trap '' HUP
claude ${claudeArgs}
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
 * Generate an AI title for a conversation using Claude CLI (T3Code pattern).
 * Runs `claude -p --output-format json --json-schema ...` with the first message
 * as input, then updates the conversation title if it hasn't been manually renamed.
 */
async function generateAiTitle(conversationName: string, firstMessage: string): Promise<void> {
  const conv = getConversationByName(conversationName);
  if (!conv || !canReplaceTitle(conv)) return;

  const schema = JSON.stringify({
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  });

  const prompt = [
    'You write concise thread titles for coding conversations.',
    'Summarize the user\'s request in 3-8 words.',
    'Avoid quotes, filler, prefixes, and trailing punctuation.',
    '',
    'User message:',
    firstMessage,
  ].join('\n');

  const { stdout } = await execAsync(
    `echo ${JSON.stringify(prompt)} | claude -p --output-format json --json-schema ${JSON.stringify(schema)} --model claude-haiku-4-5-20251001 --dangerously-skip-permissions`,
    { encoding: 'utf-8', timeout: 30_000 },
  );

  // Claude CLI returns { structured_output: { title: "..." }, ... } or { result: "..." }
  const parsed = JSON.parse(stdout.trim());
  const aiTitle: string | undefined =
    parsed?.structured_output?.title ?? parsed?.title;

  if (!aiTitle || !aiTitle.trim()) return;

  // Sanitize: strip quotes, normalize whitespace, take first line only
  const sanitized = aiTitle
    .trim()
    .split(/\r?\n/)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!sanitized) return;

  // Re-check eligibility (may have been renamed while we waited)
  const freshConv = getConversationByName(conversationName);
  if (!freshConv || !canReplaceTitle(freshConv)) return;

  updateConversationTitle(conversationName, sanitized, 'ai');
  console.log(`[conversations] AI title for "${conversationName}": ${sanitized}`);
}

// ─── Route: GET /api/conversations ───────────────────────────────────────────

const getConversationsRoute = HttpRouter.add(
  'GET',
  '/api/conversations',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
    try {
        const conversations = listConversations();

        // Enrich with live tmux status
        // Grace period: treat recently-created active conversations as alive (tmux may not have
        // started yet — spawn is async). After 30s we fall back to the actual tmux check.
        const SPAWN_GRACE_MS = 30_000;
        const enriched = await Promise.all(
          conversations.map(async (conv) => {
            const withinGrace =
              conv.status === 'active' &&
              !conv.endedAt &&
              Date.now() - new Date(conv.createdAt).getTime() < SPAWN_GRACE_MS;
            const sessionAlive = withinGrace || (await tmuxSessionExists(conv.tmuxSession));
            return { ...conv, sessionAlive };
          }),
        );

        return jsonResponse(enriched);
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to list conversations: ' + msg }, { status: 500 });
        }})
  }),
);

// ─── Route: POST /api/conversations ──────────────────────────────────────────
//
// Unified spawn + create endpoint. Called on first message from draft mode.
// Spawns Claude Code with selected model/effort, creates DB record, sends message.
// Accepts: { message, model?, effort?, issueId? }

const postConversationRoute = HttpRouter.add(
  'POST',
  '/api/conversations',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
        const model = typeof body['model'] === 'string' ? body['model'].trim() : undefined;
        const effort = typeof body['effort'] === 'string' ? body['effort'].trim() : undefined;
        const issueId = typeof body['issueId'] === 'string' ? body['issueId'] : undefined;
        const cwd = join(homedir(), 'Projects');

        if (!message) {
          return jsonResponse({ error: 'message is required' }, { status: 400 });
        }

        // Generate identifiers
        const name = generateConversationName();
        const tmuxSession = `conv-${name}`;
        const claudeSessionId = randomUUID();
        const sessionFile = sessionFilePath(cwd, claudeSessionId);

        console.log(`[conversations] Creating conversation "${name}" with model=${model ?? 'default'} effort=${effort ?? 'default'}`);

        // Spawn tmux session with model + effort + deterministic session ID
        await spawnConversationSession(tmuxSession, cwd, claudeSessionId, model, effort, issueId);
        console.log(`[conversations] tmux session ${tmuxSession} spawned, JSONL: ${sessionFile}`);

        // Title = truncated first message (T3Code pattern)
        const MAX_TITLE_LEN = 60;
        const title = message.slice(0, MAX_TITLE_LEN) + (message.length > MAX_TITLE_LEN ? '…' : '');

        // Create DB record
        const conv = createConversation({
          name,
          tmuxSession,
          cwd,
          issueId,
          sessionFile,
          title,
          titleSource: 'auto',
          titleSeed: title,
          model,
          effort,
        });

        // Wait for Claude Code to be ready, send message, and generate title — all async.
        // Don't block the HTTP response; the frontend will poll for messages.
        void (async () => {
          try {
            await waitForClaudeReady(tmuxSession);
            await sendKeysAsync(tmuxSession, message, 'conversation-message');
            void generateAiTitle(name, message).catch((err: unknown) => {
              console.error(`[conversations] AI title generation failed for "${name}":`, err);
            });
          } catch (err) {
            console.error(`[conversations] Failed to send first message to ${tmuxSession}:`, err);
          }
        })();

        return jsonResponse({ ...conv, sessionAlive: true }, { status: 201 });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to create conversation: ' + msg }, { status: 500 });
      }
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
    return yield* Effect.promise(async () => {
    try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        // Kill tmux session
        await execAsync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' });

        // Mark ended in DB
        markConversationEnded(name);

        return jsonResponse({ success: true });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to delete conversation: ' + msg }, { status: 500 });
        }})
  }),
);

// ─── Route: POST /api/conversations/:name/resume ─────────────────────────────

const postConversationResumeRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/resume',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
    try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        // Allow model/effort override from request body; fall back to stored values
        const model = typeof body['model'] === 'string' && body['model'].trim()
          ? body['model'].trim()
          : (conv.model ?? undefined);
        const effort = typeof body['effort'] === 'string' && body['effort'].trim()
          ? body['effort'].trim()
          : (conv.effort ?? undefined);

        const sessionAlive = await tmuxSessionExists(conv.tmuxSession);

        if (sessionAlive) {
          // Reattach: just update last_attached_at and mark active
          updateLastAttached(name);
          markConversationActive(name);
          return jsonResponse({ ...conv, status: 'active', reattached: true });
        }

        // Respawn: resume the previous Claude Code session using --resume
        // Extract the session UUID from the existing session file path
        const oldSessionId = conv.sessionFile
          ? conv.sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined
          : undefined;
        spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), model, effort, conv.issueId ?? undefined, !!oldSessionId).catch(
          (err: unknown) => {
            console.error(`[conversations] Failed to respawn session ${conv.tmuxSession}:`, err);
          },
        );

        markConversationActive(name);
        return jsonResponse({ ...conv, status: 'active', reattached: false });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to resume conversation: ' + msg }, { status: 500 });
        }})
  }),
);

// ─── Route: POST /api/conversations/:name/switch-model ───────────────────────
//
// Kill the current session (if alive), update the model in the DB, and resume.
// Used by the model picker in the sidebar to switch models without going through
// the full resume flow.

const postConversationSwitchModelRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/switch-model',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        const model = typeof body['model'] === 'string' && body['model'].trim()
          ? body['model'].trim()
          : (conv.model ?? undefined);

        // Always kill the existing session first (if alive) so the model change takes effect
        await execAsync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' });

        // Persist the new model
        if (model) updateConversationModel(name, model);

        // Extract the session UUID from the existing session file path
        const oldSessionId = conv.sessionFile
          ? conv.sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined
          : undefined;

        // Spawn with the new model
        spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), model, conv.effort ?? undefined, conv.issueId ?? undefined, !!oldSessionId).catch(
          (err: unknown) => {
            console.error(`[conversations] Failed to respawn session after model switch ${conv.tmuxSession}:`, err);
          },
        );

        markConversationActive(name);
        return jsonResponse({ ...conv, status: 'active', model, reattached: false });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to switch model: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: GET /api/conversations/:name/messages ────────────────────────────

const getConversationMessagesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/messages',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);

        // Fall back to specialist session file when name is a specialist tmux session
        // (e.g. specialist-panopticon-cli-merge-agent) and not in the conversations DB.
        let sessionFile: string | null | undefined = conv?.sessionFile;
        if (!conv) {
          const specialistMatch = name.match(/^specialist-(.+)-(review-agent|test-agent|merge-agent)$/);
          if (specialistMatch) {
            const [, project, type] = specialistMatch;
            const panHome = process.env['PANOPTICON_HOME'] || join(homedir(), '.panopticon');
            const sessionIdFile = join(panHome, 'specialists', 'projects', project, `${type}.session`);
            try {
              const { readFile, readdir } = await import('node:fs/promises');
              const sessionId = (await readFile(sessionIdFile, 'utf-8')).trim();
              if (sessionId) {
                const claudeProjects = join(homedir(), '.claude', 'projects');
                const dirs = await readdir(claudeProjects);
                for (const dir of dirs) {
                  const candidate = join(claudeProjects, dir, `${sessionId}.jsonl`);
                  if (existsSync(candidate)) {
                    sessionFile = candidate;
                    break;
                  }
                }
              }
            } catch { /* session file not found */ }
          }
          if (!sessionFile) {
            return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
          }
        }

        if (!sessionFile) {
          // Session file should always be set (deterministic from --session-id).
          // If missing, it's a legacy conversation — return empty.
          return jsonResponse({ messages: [], workLog: [], streaming: false });
        }

        try {
          // Specialists: parse only from the last compact_boundary so the display
          // shows only the current context window, not the full 30-day history.
          const isSpecialist = !conv && /^specialist-/.test(name);
          const result = isSpecialist
            ? await parseFromLastCompactBoundary(sessionFile)
            : await parseConversationMessages(sessionFile, 0);

          // Cache cost in DB so the conversation list can show it without re-parsing
          if (result.totalCost > 0 && conv) {
            updateConversationCost(name, result.totalCost);
          }

          return jsonResponse({
            messages: result.messages,
            workLog: result.workLog,
            streaming: result.streaming,
            totalCost: result.totalCost,
          });
        } catch (parseErr: unknown) {
          // File may not exist yet — Claude Code is still starting up.
          // Return empty messages rather than 500.
          const code = (parseErr as { code?: string })?.code;
          if (code === 'ENOENT') {
            return jsonResponse({ messages: [], workLog: [], streaming: false });
          }
          throw parseErr;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to load messages: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: POST /api/conversations/:name/message ────────────────────────────

const postConversationMessageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/message',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
        if (!message) {
          return jsonResponse({ error: 'Message is required' }, { status: 400 });
        }

        // Deliver via tmux load-buffer + paste-buffer (reliable delivery pattern)
        await sendKeysAsync(conv.tmuxSession, message, 'conversation-message');

        return jsonResponse({ ok: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to send message: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: PATCH /api/conversations/:name ────────────────────────────────────

const patchConversationRoute = HttpRouter.add(
  'PATCH',
  '/api/conversations/:name',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const req = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const body = await req.json as { title?: string };
        if (typeof body.title === 'string' && body.title.trim()) {
          // User explicitly renamed → mark as 'manual' so AI won't auto-replace
          updateConversationTitle(name, body.title.trim(), 'manual');
        }
        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to update conversation: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: POST /api/conversations/:name/archive ───────────────────────────

const postConversationArchiveRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/archive',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        // Kill tmux session if still alive
        await execAsync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' });

        // Mark as ended and archived
        markConversationEnded(name);
        archiveConversation(name);

        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to archive conversation: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: POST /api/conversations/restart-all ─────────────────────────────
//
// Kill all active conversation tmux sessions and re-spawn them with
// their stored model/effort. Useful when model persistence was fixed
// and existing sessions need to pick up the correct model.

const postConversationRestartAllRoute = HttpRouter.add(
  'POST',
  '/api/conversations/restart-all',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      try {
        const allConvs = listConversations();
        // Filter to conversations with a live tmux session
        const convs: typeof allConvs = [];
        for (const c of allConvs) {
          if (await tmuxSessionExists(c.tmuxSession)) convs.push(c);
        }
        const results: { name: string; model: string | null; status: string }[] = [];

        for (const conv of convs) {
          try {
            // Kill existing tmux session
            await execAsync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null || true`, { encoding: 'utf-8' });

            // Re-spawn with stored model
            const oldSessionId = conv.sessionFile
              ? conv.sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined
              : undefined;
            await spawnConversationSession(
              conv.tmuxSession,
              conv.cwd,
              oldSessionId ?? randomUUID(),
              conv.model ?? undefined,
              conv.effort ?? undefined,
              conv.issueId ?? undefined,
              !!oldSessionId,
            );
            markConversationActive(conv.name);
            results.push({ name: conv.name, model: conv.model, status: 'restarted' });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[conversations] Failed to restart ${conv.name}:`, msg);
            results.push({ name: conv.name, model: conv.model, status: `failed: ${msg}` });
          }
        }

        console.log(`[conversations] Restarted ${results.filter(r => r.status === 'restarted').length}/${convs.length} conversations`);
        return jsonResponse({ restarted: results.length, results });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to restart conversations: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const conversationsRouteLayer = Layer.mergeAll(
  getConversationsRoute,
  postConversationRoute,
  patchConversationRoute,
  deleteConversationRoute,
  postConversationResumeRoute,
  postConversationSwitchModelRoute,
  postConversationRestartAllRoute,
  postConversationArchiveRoute,
  getConversationMessagesRoute,
  postConversationMessageRoute,
);

export default conversationsRouteLayer;
