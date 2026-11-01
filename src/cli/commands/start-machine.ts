/**
 * `pan start <issue> --machine <label|auto>` (PAN-4651 FR-1, D-4651-7,
 * D-4651-12). `startOnMachine` answers false when the target is this machine
 * (the local `pan start` path continues), and true once it handled the start
 * on another machine or refused it (the exit code is already set).
 *
 * Before a remote start it refuses unpushed commits in the issue's local
 * workspace (unless `--push-first` / `--ignore-unpushed`), then posts
 * `POST /api/fleet/issues/:id/start` with this process's sender.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { exitCli } from '../exit.js';
import type { IssueOptions } from './start-options.js';
import { defaultRemoteWorkerCliDeps, parseNeedsFlag, resolveMachineFlag, type RemoteWorkerCliDeps } from './worker-remote.js';

export interface StartMachineDeps extends RemoteWorkerCliDeps {
  /** The issue's local workspace when it exists, for the unpushed-commit check. */
  workspaceOf: (issueId: string) => Promise<string | null>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exit: (code: number) => Promise<void>;
}

export const defaultStartMachineDeps = (): StartMachineDeps => ({
  ...defaultRemoteWorkerCliDeps(),
  workspaceOf: async (issueId) => {
    const [{ Effect }, { resolveProjectFromIssue }] = await Promise.all([import('effect'), import('../../lib/projects.js')]);
    const project = await Effect.runPromise(resolveProjectFromIssue(issueId)).catch(() => null);
    if (!project) return null;
    const workspace = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    return access(workspace).then(() => workspace, () => null);
  },
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
  exit: async (code) => { await exitCli(code); },
});

const errorOf = (json: unknown, status: number): string => {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : `HTTP ${status}`;
};

export async function startOnMachine(id: string, options: IssueOptions, deps: StartMachineDeps = defaultStartMachineDeps()): Promise<boolean> {
  const issueId = id.toUpperCase();
  const needs = parseNeedsFlag(options.needs);
  const refuse = async (message: string): Promise<true> => {
    deps.stderr(message);
    await deps.exit(1);
    return true;
  };
  let target;
  try {
    target = await resolveMachineFlag(options.machine!, needs, await deps.issueOrigin(issueId), deps);
  } catch (error) {
    return refuse(`Could not reach the dashboard to place ${issueId}: ${(error as Error).message}`);
  }
  if (target.kind === 'error') return refuse(target.message);
  if (target.kind === 'self') {
    if (target.reason) deps.stderr(target.reason);
    return false;
  }
  const workspace = await deps.workspaceOf(issueId);
  if (workspace) {
    const check = await deps.pushCheck(workspace, { label: target.label, pushFirst: options.pushFirst, ignoreUnpushed: options.ignoreUnpushed });
    if (!check.ok) return refuse(check.message);
    if (check.note) deps.stderr(check.note);
  }
  const body: Record<string, unknown> = { machine: target.machine };
  if (needs.length > 0) body.needs = needs;
  for (const key of ['model', 'harness', 'effort'] as const) if (options[key]) body[key] = options[key];
  const answer = await deps.call(`/api/fleet/issues/${encodeURIComponent(issueId)}/start`, {
    method: 'POST', body, headers: { 'x-overdeck-sender': deps.senderId() },
  });
  if (answer.status !== 200) return refuse(`Could not start ${issueId} on ${target.label}: ${errorOf(answer.json, answer.status)}`);
  deps.stdout(`Started ${issueId} on ${target.label}`);
  if (target.reason) deps.stdout(target.reason);
  return true;
}
