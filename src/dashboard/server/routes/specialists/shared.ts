import { exec, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';

import {
  type AgentRuntimeState,
  type AgentState,
} from '../../../../lib/agents.js';
import { createInFlightGuard } from '../../../../lib/cloister/in-flight-guard.js';
import { extractPrefixSync } from '../../../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';

export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export type SpecialistAgentName = 'merge-agent' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent';
export type ProjectSpecialistAgentName = 'review-agent' | 'test-agent' | 'merge-agent';
export type SpecialistEventRole = 'review' | 'test' | 'ship';

export function validateSpecialistAgentName(type: string): type is ProjectSpecialistAgentName {
  return type === 'review-agent' || type === 'test-agent' || type === 'merge-agent';
}

export function specialistEventRole(name: string): SpecialistEventRole | undefined {
  if (name === 'review' || name === 'review-agent') return 'review';
  if (name === 'test' || name === 'test-agent') return 'test';
  if (name === 'merge' || name === 'merge-agent') return 'ship';
  return undefined;
}

export function specialistNameForRole(role: string | undefined): ProjectSpecialistAgentName | null {
  const baseRole = role?.split('.')[0];
  if (baseRole === 'review') return 'review-agent';
  if (baseRole === 'test') return 'test-agent';
  if (baseRole === 'ship') return 'merge-agent';
  return null;
}

export type SpecialistAutoCompleteBody = {
  agentId?: string;
  issueId?: string;
  role?: string;
  sessionId?: string | null;
  status?: string;
  notes?: string;
};

export function validateSpecialistAutoCompleteMetadata(
  name: string,
  body: SpecialistAutoCompleteBody,
  agentState: AgentState | null,
  runtimeState: AgentRuntimeState | null,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!validateSpecialistAgentName(name)) {
    return { ok: false, status: 400, error: `Invalid specialist name: ${name}` };
  }
  if (!body.issueId || !body.status) {
    return { ok: false, status: 400, error: 'issueId and status required' };
  }
  if (body.status !== 'passed' && body.status !== 'failed') {
    return { ok: false, status: 400, error: 'status must be passed or failed' };
  }
  if (!body.agentId || !body.role) {
    return { ok: false, status: 400, error: 'agentId and role required' };
  }

  const normalizedIssueId = body.issueId.toUpperCase();
  const expectedName = specialistNameForRole(body.role);
  if (expectedName !== name) {
    return { ok: false, status: 403, error: 'role does not match specialist' };
  }
  if (!agentState || agentState.id !== body.agentId) {
    return { ok: false, status: 403, error: 'agent run not found' };
  }
  if (agentState.issueId.toUpperCase() !== normalizedIssueId) {
    return { ok: false, status: 403, error: 'agent issue does not match request' };
  }
  if (specialistNameForRole(agentState.role) !== name) {
    return { ok: false, status: 403, error: 'agent role does not match specialist' };
  }
  if (agentState.status !== 'running' && agentState.status !== 'starting') {
    return { ok: false, status: 409, error: 'agent run is not active' };
  }
  if (runtimeState?.currentIssue && runtimeState.currentIssue.toUpperCase() !== normalizedIssueId) {
    return { ok: false, status: 403, error: 'runtime issue does not match request' };
  }
  if (runtimeState?.claudeSessionId && body.sessionId !== runtimeState.claudeSessionId) {
    return { ok: false, status: 403, error: 'session does not match active run' };
  }

  return { ok: true };
}

// Read the request body as unknown JSON
export const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Idempotency guard: prevent concurrent postMergeLifecycle re-entry ────────
// PAN-328: the loop specialists/done → onMergeComplete → postMergeLifecycle →
// (re-trigger) → specialists/done once burned 24,626 tracker API calls. The
// in-flight guard makes a second *concurrent* call for the same issue a no-op.
// The invariant is enforced by tests/unit/lib/cloister/in-flight-guard.test.ts
// — delete the guard and that suite goes red.
const postMergeGuard = createInFlightGuard();

// Track issues where the server is managing the merge lifecycle (polyrepo).
// Exported so the workspaces route can register/unregister server-managed merges.
export const _serverManagedMerges = new Set<string>();

/**
 * Exported for the UAT batch-promote route (PAN-1737): batch promotion fans
 * out the per-member post-merge through THIS guard instance so an issue's
 * lifecycle still runs at most once regardless of which path merged it.
 * Returns false when a run for the issue is already in flight.
 */
export function firePostMergeLifecycle(issueId: string): boolean {
  const started = postMergeGuard.run(
    issueId,
    async () => {
      const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
      const projectPath = getProjectPathForIssue(issuePrefix);
      const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
      await postMergeLifecycle(issueId, projectPath);
      console.log(`[merge] post-merge lifecycle completed for ${issueId}`);

      // PAN-1691: roll the merge train — rebase ready siblings onto the new main,
      // re-verify the clean ones, agent-resolve conflicts. No-op unless the
      // flywheel.merge_train_enabled flag is on. Runs inside the in-flight guard,
      // so it cannot re-enter postMergeLifecycle for this issue.
      const { runMergeTrainReconcile } = await import('../../../../lib/cloister/merge-train.js');
      const outcomes = await runMergeTrainReconcile(issueId);
      if (outcomes.length > 0) {
        console.log(
          `[merge-train] reconciled ${outcomes.length} sibling(s) after ${issueId}: ` +
            outcomes.map((o) => `${o.issueId}=${o.result}`).join(', '),
        );
      }
    },
    (err) => console.error(`[merge] post-merge lifecycle failed for ${issueId}:`, err),
  );
  if (!started) {
    console.log(`[merge] firePostMergeLifecycle: skipping ${issueId} — already in flight`);
  }
  return started;
}

export function getProjectPathForIssue(issuePrefix: string): string {
  const issueId = `${issuePrefix}-1`;
  const resolved = resolveProjectFromIssueSync(issueId);
  if (resolved) return resolved.projectPath;
  return join(homedir(), 'Projects');
}
