/**
 * tmux terminal backend adapter (PAN-3917 FR-3, FR-17, W8).
 *
 * Wraps what Overdeck has always done: one tmux session per agent on the
 * `overdeck` socket, created with `createSession`, messaged with `sendKeys`,
 * and judged alive by the single liveness oracle (`src/lib/agents/liveness.ts`).
 * Nothing about the tmux path changes — session names, the PTY supervisor, and
 * the delivery cascade are the same as before; this adapter only gives them the
 * backend contract's shape.
 *
 * What tmux cannot do is a value, never a throw: `wait` (there is no agent
 * state machine to wait on), `blocked` (no approval-UI detector), native
 * `resume`, metadata tokens (a tmux pane carries none — the launch metadata
 * lives in the agent state file), and the observe/control streams (the
 * dashboard serves tmux terminals through its own PTY supervisor) all return
 * `unsupported` with a reason.
 */

import { Effect } from 'effect';

// PAN-3917/lint:circular: agent-state.ts's write side chains through
// registry/feature-registry-population.ts back to agents.ts, which imports
// this backend transitively — import the read-only leaf instead so a terminal
// backend computing pane tokens cannot close that cycle.
import { getAgentState } from '../agents/agent-state-read.js';
import { isAliveOnTmux, isIdle } from '../agents/liveness.js';
import { shellQuoteArg } from '../shell-quote.js';
import { createSession, killSession, listSessions, sendKeys, sessionExists } from '../tmux.js';
import { checkPrompt, toPaneRole, tokensFromLaunchMetadata } from './prompt-guard.js';
import { registerTerminalBackend } from './registry.js';
import {
  TerminalBackendError,
  unsupported,
  type AgentPaneRef,
  type AgentState,
  type AgentTarget,
  type BackendAgentSnapshot,
  type BackendEventStream,
  type BackendResult,
  type BackendRef,
  type Ok,
  type PaneTokens,
  type PromptOptions,
  type PromptResult,
  type StartAgentSpec,
  type TerminalBackend,
  type TerminalControl,
  type TerminalObservation,
  type WaitResult,
  type WorkspaceRef,
} from './types.js';

const BACKEND = 'tmux' as const;

/**
 * The target's tokens on tmux. There are no pane tokens, so they come from the
 * agent's launch metadata — the same four values a Herdr pane is stamped with.
 */
/** Session names Overdeck launches: agents, planners, strikes and conversations. */
const OVERDECK_SESSION_NAME = /^(agent|planning|strike|conv)-/;

export function tmuxTargetTokens(sessionName: string): Partial<PaneTokens> {
  return tokensFromLaunchMetadata(getAgentState(sessionName));
}

function sessionNameOf(target: AgentTarget): string {
  if ('paneId' in target && target.paneId) return target.paneId;
  if ('agentName' in target && target.agentName) return target.agentName;
  throw new Error('prompt target carries neither a pane id nor an agent name');
}

function fail(operation: string, cause: unknown): TerminalBackendError {
  return new TerminalBackendError({
    backend: BACKEND,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function attempt<T>(operation: string, run: () => Promise<T>): Effect.Effect<T, TerminalBackendError> {
  return Effect.tryPromise({ try: run, catch: (cause) => fail(operation, cause) });
}

export { toPaneRole };

export class TmuxBackend implements TerminalBackend {
  readonly name = BACKEND;

  /**
   * tmux has no workspace object: the "workspace" is the session-name prefix
   * every pane for this issue shares (`agent-<issue>`), exactly as today.
   */
  workspaceFor(issueId: string, cwd: string): Effect.Effect<BackendResult<WorkspaceRef>, TerminalBackendError> {
    return Effect.succeed({
      backend: BACKEND,
      workspaceId: `agent-${issueId.toLowerCase()}`,
      issueId,
      cwd,
    });
  }

  /**
   * Create the agent's tmux session with its launch command and env. The
   * session name is the agent id the caller passes as `spec.name`, so every
   * existing `pan tell`, liveness probe, and dashboard lookup keeps working.
   */
  startAgent(
    workspace: WorkspaceRef,
    spec: StartAgentSpec,
  ): Effect.Effect<BackendResult<AgentPaneRef>, TerminalBackendError> {
    return attempt('startAgent', async () => {
      const sessionName = spec.name;
      if (!sessionName) throw new Error('the tmux backend needs spec.name — the tmux session is named after the agent');
      const cwd = spec.cwd ?? workspace.cwd;
      // tmux runs the command through `sh -c`, so each argument is quoted — an
      // OVERDECK_HOME with a space must not split the launcher path.
      const command = spec.argv.map(shellQuoteArg).join(' ');
      await Effect.runPromise(createSession(sessionName, cwd, command, { env: { ...spec.env } }));
      return {
        backend: BACKEND,
        workspaceId: workspace.workspaceId,
        paneId: sessionName,
        terminalId: sessionName,
        agentName: sessionName,
      };
    });
  }

  /**
   * FR-17 for tmux. The full delivery cascade (PTY supervisor, app-server, ACP,
   * Channels, tmux) lives in `src/lib/agents/delivery.ts` and runs the same
   * guard; this is the direct backend path for callers holding a pane ref.
   */
  prompt(
    target: AgentTarget,
    text: string,
    options: PromptOptions,
  ): Effect.Effect<PromptResult, TerminalBackendError> {
    return attempt('prompt', async () => {
      const sessionName = sessionNameOf(target);
      const verdict = checkPrompt({
        targetId: sessionName,
        targetTokens: tmuxTargetTokens(sessionName),
        sender: options.sender,
        messageId: options.messageId,
      });
      if ('refused' in verdict) return { refused: true, reason: verdict.reason };
      if ('dropped' in verdict) return { dropped: true, reason: verdict.reason };

      await Effect.runPromise(sendKeys(sessionName, text, 'tmux-backend:prompt'));
      return { delivered: true, messageId: options.messageId };
    });
  }

  wait(): Effect.Effect<BackendResult<WaitResult>, TerminalBackendError> {
    return Effect.succeed(
      unsupported('tmux reports no agent lifecycle state, so there is nothing to wait on; poll liveness instead'),
    );
  }

  observe(): Effect.Effect<BackendResult<TerminalObservation>, TerminalBackendError> {
    return Effect.succeed(
      unsupported('tmux terminals are served by the dashboard PTY supervisor, not by a backend stream'),
    );
  }

  control(): Effect.Effect<BackendResult<TerminalControl>, TerminalBackendError> {
    return Effect.succeed(
      unsupported('tmux terminals are served by the dashboard PTY supervisor, not by a backend stream'),
    );
  }

  /**
   * Live inventory: every tmux session on the Overdeck socket, with the
   * liveness oracle's verdict mapped to the contract's states. `blocked` and
   * `done` do not exist on tmux; idleness is stale work activity, exactly as
   * `liveness.isIdle` computes it today.
   */
  list(): Effect.Effect<BackendResult<readonly BackendAgentSnapshot[]>, TerminalBackendError> {
    return attempt('list', async () => {
      const sessions = await Effect.runPromise(listSessions());
      const snapshots: BackendAgentSnapshot[] = [];
      for (const session of sessions) {
        const verdict = await isAliveOnTmux(session.name);
        // A failed ps/pgrep probe (`runtime-indeterminate`) is unknown, not
        // exited: the inventory drops exited panes, and a live agent missing
        // from a readable inventory reads as a crash (#4109 review).
        const state: AgentState = verdict.alive
          ? isIdle(session.name) ? 'idle' : 'working'
          : verdict.reason === 'runtime-indeterminate'
            ? 'unknown'
            : 'exited';
        const tokens = tmuxTargetTokens(session.name);
        snapshots.push({
          backend: BACKEND,
          paneId: session.name,
          // PAN-3920: only an Overdeck session (agent state or managed name) names an agent.
          ...(tokens.role || OVERDECK_SESSION_NAME.test(session.name) ? { agentId: session.name } : {}),
          terminalId: session.name,
          workspaceId: tokens.issue ? `agent-${tokens.issue.toLowerCase()}` : session.name,
          state,
          tokens,
        });
      }
      return snapshots;
    });
  }

  events(): Effect.Effect<BackendResult<BackendEventStream>, TerminalBackendError> {
    return Effect.succeed(
      unsupported('tmux emits no lifecycle events; the dashboard polls `list()` for tmux sessions'),
    );
  }

  reportMetadata(): Effect.Effect<BackendResult<Ok>, TerminalBackendError> {
    return Effect.succeed(
      unsupported('a tmux pane carries no metadata tokens; the agent launch metadata is their source on tmux'),
    );
  }

  close(ref: BackendRef): Effect.Effect<BackendResult<Ok>, TerminalBackendError> {
    return attempt('close', async () => {
      const name = 'paneId' in ref ? ref.paneId : ref.workspaceId;
      if (await Effect.runPromise(sessionExists(name))) {
        await Effect.runPromise(killSession(name));
      }
      return { ok: true };
    });
  }

  resume(): Effect.Effect<BackendResult<AgentPaneRef>, TerminalBackendError> {
    return Effect.succeed(
      unsupported('tmux cannot resume a harness; relaunch it with its own resume flag via startAgent'),
    );
  }
}

export const tmuxBackend = new TmuxBackend();

registerTerminalBackend(tmuxBackend);
