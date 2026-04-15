import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
/**
 * Admin route module — plumbing endpoints
 *
 * Implements /api/admin/* endpoints mirroring the `pan admin` CLI namespace:
 *   GET  /api/admin/tldr/:issueId     — TLDR daemon status for a workspace
 *   GET  /api/admin/skills/audit      — Skill audit: audience, sync destinations, stale copies (PAN-709)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getTldrDaemonService } from '../../../lib/tldr-daemon.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { auditSkills } from '../../../cli/commands/admin/skills-handler.js';

// ─── Route: GET /api/admin/tldr/:issueId ──────────────────────────────────────

const getAdminTldrRoute = HttpRouter.add(
  'GET',
  '/api/admin/tldr/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const project = resolveProjectFromIssue(issueId);
    const projectPath = project?.path ?? process.cwd();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    const venvPath = join(workspacePath, '.venv');

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
    }

    if (!existsSync(venvPath)) {
      return jsonResponse({ available: false, reason: 'No .venv found in workspace' });
    }

    return yield* Effect.promise(async () => {
      const service = getTldrDaemonService(workspacePath, venvPath);
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

// ─── Route: GET /api/admin/skills/audit ──────────────────────────────────────

const getAdminSkillsAuditRoute = HttpRouter.add(
  'GET',
  '/api/admin/skills/audit',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      const records = await auditSkills();
      return jsonResponse(records);
    });
  }))
);

export const adminRouteLayer = Layer.mergeAll(
  getAdminTldrRoute,
  getAdminSkillsAuditRoute,
);

export default adminRouteLayer;
