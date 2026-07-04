import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { findPlan } from '../vbrief/io.js';
import { resolveIssueProjectPathSync } from './issue-reads.js';

export function buildChildStoriesFromRally(
  children: readonly { ref: string; title: string; status: string; description: string }[],
): Array<{ ref: string; title: string; status: string; description: string }> {
  return children.map((c) => ({
    ref: c.ref,
    title: c.title,
    status: c.status,
    description: c.description || '',
  }));
}

export function generateTasksForIssue(id: string) {
  return Effect.gen(function* () {
    const issueLower = id.toLowerCase();
    const projectPath = resolveIssueProjectPathSync(id);

    if (!projectPath) {
      return jsonResponse({ success: false, error: `Could not resolve project path for ${id}` }, { status: 404 });
    }

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planPath = yield* findPlan(workspacePath);
    if (!planPath || !existsSync(planPath)) {
      return jsonResponse(
        { success: false, error: `No vBRIEF spec found on main for ${id} — run planning first.` },
        { status: 409 },
      );
    }

    const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../vbrief/beads.js'));
    const result = yield* createBeadsFromVBrief(workspacePath);

    if (!result.success || result.created.length === 0) {
      const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
      return jsonResponse({ success: false, created: result.created, errors }, { status: 500 });
    }

    return jsonResponse({
      success: true,
      created: result.created,
      count: result.created.length,
    });
  });
}
