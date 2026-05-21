/**
 * AgentSpawner Effect service (PAN-449)
 *
 * Wraps agents.ts in an Effect service with typed errors.
 * Route handlers use this instead of importing from lib/agents.ts directly.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer, Context } from 'effect';
import {
  AgentAlreadyRunning,
  AgentStartError,
  BeadsNotInitialized,
  WorkspaceNotFound,
} from './typed-errors.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface StartWorkOptions {
  readonly workspacePath: string;
  readonly model?: string;
  readonly phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response';
  readonly prompt?: string;
  readonly agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';
  readonly allowHost?: boolean;
}

export interface StartPlanningOptions {
  readonly workspacePath: string;
  readonly projectPath: string;
  /** Issue details needed to build the planning prompt */
  readonly issue: {
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly description: string;
    readonly url: string;
    readonly source: 'linear' | 'github' | 'rally';
  };
  readonly sessionName?: string;
  readonly shadowMode?: boolean;
}

export interface SpawnedAgent {
  readonly id: string;
  readonly issueId: string;
  readonly sessionName: string;
  readonly workspacePath: string;
}

export interface DeepWipeOptions {
  /** Must be explicitly true — guards against accidental deep-wipe invocations */
  readonly confirmed: true;
  readonly deleteWorkspace?: boolean;
  readonly deleteBranches?: boolean;
  readonly resetIssue?: boolean;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface AgentSpawnerShape {
  /**
   * Start a work agent for an issue.
   *
   * Pre-conditions:
   * - The workspace must exist (WorkspaceNotFound if not)
   * - Beads tasks must be initialized (BeadsNotInitialized if not)
   * - No agent already running for this issue (AgentAlreadyRunning if so)
   */
  readonly startWork: (
    issueId: string,
    opts: StartWorkOptions,
  ) => Effect.Effect<
    SpawnedAgent,
    WorkspaceNotFound | BeadsNotInitialized | AgentAlreadyRunning | AgentStartError
  >;

  /**
   * Start a planning agent for an issue.
   *
   * Creates the workspace planning artifacts, writes the planning prompt, and sets tmux options
   * (remain-on-exit on, destroy-unattached off), and spawns the planning session.
   */
  readonly startPlanning: (
    issueId: string,
    opts: StartPlanningOptions,
  ) => Effect.Effect<void, WorkspaceNotFound | AgentStartError>;

  /**
   * Stop (kill) a running agent by its ID or issue ID.
   * Non-fatal if the agent is already stopped.
   */
  readonly kill: (agentId: string) => Effect.Effect<void, never>;

  /**
   * Send a message to a running agent.
   * If the agent is stopped or suspended, it will be auto-restarted.
   */
  readonly message: (
    agentId: string,
    msg: string,
  ) => Effect.Effect<void, AgentStartError>;

  /**
   * Deep-wipe a workspace: removes workspace directory, deletes branches,
   * resets the issue to open/backlog, and clears agent state.
   *
   * DESTRUCTIVE — requires explicit `confirmed: true` to prevent accidental use.
   */
  readonly deepWipe: (
    issueId: string,
    opts: DeepWipeOptions,
  ) => Effect.Effect<void, AgentStartError>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class AgentSpawner extends Context.Service<AgentSpawner, AgentSpawnerShape>()(
  'panopticon/dashboard/AgentSpawner',
) {}

// ─── Live layer ───────────────────────────────────────────────────────────────

export const AgentSpawnerLive = Layer.effect(
  AgentSpawner,
  Effect.sync(() => ({
    startWork: (issueId, opts) =>
      Effect.tryPromise({
        try: async () => {
          const { workspacePath } = opts;

          // Guard: reject bare numeric IDs (e.g. "484") — they have no project prefix,
          // so tracker routing, workspace naming, and beads all fail. Require "PAN-484".
          if (/^\d+$/.test(issueId)) {
            throw new AgentStartError({
              id: issueId,
              message: `Invalid issueId "${issueId}": bare numeric IDs are not allowed. Use a prefixed ID (e.g. PAN-${issueId}).`,
            });
          }

          // Guard: workspace must exist
          if (!existsSync(workspacePath)) {
            throw new WorkspaceNotFound({ id: issueId });
          }

          // Guard: beads must be initialized (check .beads dir for tasks)
          const beadsDir = join(workspacePath, '.beads');
          const projectBeadsDir = join(workspacePath, '..', '..', '.beads');
          const hasBeads = existsSync(beadsDir) || existsSync(projectBeadsDir);
          if (!hasBeads) {
            throw new BeadsNotInitialized({ workspace: workspacePath });
          }

          // Guard: no agent already running
          const { getAgentStateAsync, spawnAgent, normalizeAgentId } = await import(
            '../../../lib/agents.js'
          ) as any;
          const normalizedId = normalizeAgentId(issueId);

          const existing = await getAgentStateAsync(normalizedId);
          if (existing?.status === 'running') {
            throw new AgentAlreadyRunning({ id: issueId });
          }

          const state = await spawnAgent({
            issueId,
            workspace: workspacePath,
            model: opts.model,
            role: 'work',
            prompt: opts.prompt,
            allowHost: opts.allowHost,
          });

          return {
            id: state.id ?? normalizedId,
            issueId,
            sessionName: normalizedId,
            workspacePath,
          } satisfies SpawnedAgent;
        },
        catch: (err) => {
          if (
            err instanceof WorkspaceNotFound ||
            err instanceof BeadsNotInitialized ||
            err instanceof AgentAlreadyRunning
          ) return err;
          return new AgentStartError({
            id: issueId,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          });
        },
      }),

    startPlanning: (issueId, opts) =>
      Effect.tryPromise({
        try: async () => {
          const { workspacePath, projectPath, issue } = opts;

          if (!existsSync(workspacePath)) {
            throw new WorkspaceNotFound({ id: issueId });
          }

          // Delegate to spawn-planning-session
          const sessionName = opts.sessionName ?? `planning-${issueId.toLowerCase()}`;
          const { spawnPlanningSession } = await import('../../../lib/planning/spawn-planning-session.js');
          const result = await spawnPlanningSession({
            issue: {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              url: issue.url,
              source: issue.source,
            },
            workspacePath,
            projectPath,
            sessionName,
            workspaceLocation: 'local',
            shadowMode: opts.shadowMode ?? false,
          });

          if (!result.success) {
            throw new AgentStartError({
              id: issueId,
              message: result.error ?? 'Planning session failed to start',
            });
          }
        },
        catch: (err) => {
          if (err instanceof WorkspaceNotFound || err instanceof AgentStartError) return err;
          return new AgentStartError({
            id: issueId,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          });
        },
      }),

    kill: (agentId) =>
      Effect.tryPromise({
        try: async () => {
          const { stopAgentAsync } = await import('../../../lib/agents.js') as any;
          await stopAgentAsync(agentId);
        },
        catch: () => undefined,
      }).pipe(Effect.ignore),

    message: (agentId, msg) =>
      Effect.tryPromise({
        try: async () => {
          const { messageAgent } = await import('../../../lib/agents.js') as any;
          await messageAgent(agentId, msg);
        },
        catch: (err) =>
          new AgentStartError({
            id: agentId,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      }),

    deepWipe: (issueId, opts) =>
      Effect.tryPromise({
        try: async () => {
          const { deepWipe } = await import('../../../lib/lifecycle/workflows.js');
          const { resolveProjectFromIssue } = await import('../../../lib/projects.js');

          const project = resolveProjectFromIssue(issueId);
          const projectPath = project?.projectPath ?? process.cwd();

          await deepWipe(
            {
              issueId,
              projectPath,
              projectName: project?.projectName,
            },
            {
              deleteWorkspace: opts.deleteWorkspace ?? true,
              deleteBranches: opts.deleteBranches ?? true,
              resetIssue: opts.resetIssue ?? true,
            },
          );
        },
        catch: (err) =>
          new AgentStartError({
            id: issueId,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      }),
  })),
);
