import { join } from 'node:path';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { readWorkspacePlanSync } from '../vbrief/io.js';
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
    const plan = readWorkspacePlanSync(workspacePath);
    if (!plan) {
      return jsonResponse(
        { success: false, error: `No vBRIEF spec found on main for ${id} — run planning first.` },
        { status: 409 },
      );
    }

    return jsonResponse({
      success: true,
      created: plan.plan.items.map((item) => item.id),
      count: plan.plan.items.length,
    });
  });
}
