import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getTldrDaemonServiceSync } from '../../../lib/tldr-daemon.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import {
  derivePromptTitle,
} from '../../../lib/conversations/transcript-summary.js';
import {
  getCachedMessages,
  resolveSessionFile,
} from '../../../lib/overdeck/conversation-reads.js';
import {
  getConversationByName,
  listConversations,
  updateConversationTitle,
} from '../../../lib/overdeck/conversations.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { hasDashboardInternalToken } from './dashboard-auth.js';

/**
 * Admin route module — plumbing endpoints
 *
 * Implements /api/admin/* endpoints mirroring the `pan admin` CLI namespace:
 *   GET  /api/admin/tldr/:issueId          — TLDR daemon status for a workspace
 *   POST /api/admin/conversations/backfill-titles — retitle stuck conversations
 */

// ─── Route: GET /api/admin/tldr/:issueId ──────────────────────────────────────

const getAdminTldrRoute = HttpRouter.add(
  'GET',
  '/api/admin/tldr/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const project = resolveProjectFromIssueSync(issueId);
    const projectPath = project?.projectPath ?? process.cwd();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    const venvPath = join(workspacePath, '.venv');

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
    }

    if (!existsSync(venvPath)) {
      return jsonResponse({ available: false, reason: 'No .venv found in workspace' });
    }

    return yield* Effect.promise(async () => {
      const service = getTldrDaemonServiceSync(workspacePath, venvPath);
      const status = await service.getStatus();
      return jsonResponse({
        available: true,
        running: status.running,
        pid: status.pid,
        healthy: status.healthy,
        workspacePath,
      });
    });
  }))
);

export interface BackfillTitleRow {
  name: string;
  title: string;
  reason: string;
}

export interface BackfillTitlesResult {
  updated: BackfillTitleRow[];
  skipped: Array<{ name: string; reason: string }>;
  dryRun: boolean;
}

export interface BackfillTitlesDependencies {
  resolveSessionFile: typeof resolveSessionFile;
  getCachedMessages: typeof getCachedMessages;
}

export async function handleBackfillTitlesBody(
  body: { dryRun?: boolean },
  deps: BackfillTitlesDependencies,
): Promise<BackfillTitlesResult> {
  const dryRun = body.dryRun === true;
  const stuck = listConversations().filter(
    (conv) => conv.title === 'New conversation' && conv.titleSource === 'default',
  );

  const updated: BackfillTitleRow[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const conv of stuck) {
    try {
      const sessionFile = await deps.resolveSessionFile(conv);
      if (!sessionFile) {
        skipped.push({ name: conv.name, reason: 'no transcript' });
        continue;
      }

      const { messages } = await deps.getCachedMessages(sessionFile, false);
      const firstUser = messages.find(
        (m) => m.role === 'user' && typeof m.text === 'string' && m.text.trim().length > 0,
      );

      let candidate = '';
      let reason: string;
      if (firstUser) {
        candidate = derivePromptTitle(firstUser.text);
        reason = 'transcript';
      }
      if (!candidate) {
        const date = new Date(conv.createdAt).toISOString().slice(0, 10);
        candidate = `Untitled — ${date}`;
        reason = 'no transcript';
      }

      const fresh = getConversationByName(conv.name);
      if (!fresh || fresh.title !== 'New conversation' || fresh.titleSource !== 'default') {
        skipped.push({ name: conv.name, reason: 'no longer eligible' });
        continue;
      }

      if (!dryRun) {
        updateConversationTitle(conv.name, candidate, 'auto');
      }
      updated.push({ name: conv.name, title: candidate, reason });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ name: conv.name, reason: `transcript error: ${msg}` });
    }
  }

  return { updated, skipped, dryRun };
}

// ─── Route: POST /api/admin/conversations/backfill-titles ─────────────────────

const postAdminBackfillTitlesRoute = HttpRouter.add(
  'POST',
  '/api/admin/conversations/backfill-titles',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!hasDashboardInternalToken(request)) {
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    }

    const rawBody = yield* request.text;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const dryRun = body.dryRun === true;
    const result = yield* Effect.promise(() =>
      handleBackfillTitlesBody({ dryRun }, { resolveSessionFile, getCachedMessages }),
    );
    return jsonResponse(result);
  })),
);

export const adminRouteLayer = Layer.mergeAll(
  getAdminTldrRoute,
  postAdminBackfillTitlesRoute,
);

export default adminRouteLayer;
