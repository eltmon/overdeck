/**
 * AgentSpawner Effect service (PAN-449)
 *
 * Wraps agents.ts in an Effect service with typed errors.
 * Route handlers use this instead of importing from lib/agents.ts directly.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer, ServiceMap } from 'effect';
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
}

export interface SpawnedAgent {
  readonly id: string;
  readonly issueId: string;
  readonly sessionName: string;
  readonly workspacePath: string;
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
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class AgentSpawner extends ServiceMap.Service<AgentSpawner, AgentSpawnerShape>()(
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
          const { getAgentState, spawnAgent, normalizeAgentId } = await import(
            '../../../lib/agents.js'
          ) as any;
          const normalizedId = typeof normalizeAgentId === 'function'
            ? normalizeAgentId(issueId)
            : issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');

          const existing = getAgentState(normalizedId);
          if (existing?.status === 'running') {
            throw new AgentAlreadyRunning({ id: issueId });
          }

          const state = await spawnAgent({
            issueId,
            workspace: workspacePath,
            model: opts.model,
            phase: opts.phase,
            prompt: opts.prompt,
            agentType: opts.agentType ?? 'work-agent',
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

    kill: (agentId) =>
      Effect.tryPromise({
        try: async () => {
          const { stopAgent } = await import('../../../lib/agents.js') as any;
          stopAgent(agentId);
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
  })),
);
