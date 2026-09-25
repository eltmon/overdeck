import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { ensureSessionContextBriefingFile } from '../../../../lib/briefing-freshness.js';
import { getClaudePermissionFlagsString } from '../../../../lib/claude-permissions.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../../../../lib/config-yaml.js';
import { workspaceContextFile } from '../../../../lib/context-layers/layers.js';
import { extractPrefix } from '../../../../lib/issue-id.js';
import { prepareHarnessLaunch } from '../../../../lib/harness-binary.js';
import { generateLauncherScript } from '../../../../lib/launcher-generator.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../../lib/pan-dir/types.js';
import { getOverdeckHome } from '../../../../lib/paths.js';
import { extractTeamPrefix, findProjectByTeam } from '../../../../lib/projects.js';
import { loadRemoteAgentState } from '../../../../lib/remote/remote-agents.js';
import { getAgentState, saveAgentStateSync } from '../../../../lib/agents/agent-state.js';
import { deliverAgentMessage } from '../../../../lib/agents/delivery.js';
import { isAlive, isConfirmedDead } from '../../../../lib/agents/liveness.js';
import { closeAgentPane, closeAgentPaneDetailed, launchAgentPane } from '../../../../lib/terminal-backends/launch.js';
import { resizeWindow } from '../../../../lib/tmux.js';
import { findPlan, readPlan } from '../../../../lib/xbrief/io.js';
import { EventStoreService } from '../../services/domain-services.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getGitHubLocalPaths,
  getProjectPath,
  isGitHubIssue,
  readJsonBody,
} from './shared.js';

const PLANNING_FINISHED_STATUSES = new Set(['proposed', 'approved', 'pending', 'running', 'completed', 'blocked']);

const checkPlanStatus = (
  workspacePath: string,
  matchStatus: (status: string) => boolean,
): Effect.Effect<boolean, unknown> => Effect.gen(function* () {
  const planPath = yield* findPlan(workspacePath);
  if (!planPath) return false;
  const status = yield* readPlan(planPath).pipe(
    Effect.map(doc => doc.plan?.status),
    Effect.catch(() => Effect.succeed(undefined)),
  );
  return Boolean(status && matchStatus(status));
});

/**
 * How long after a launch a planner counts as live whatever the oracle says
 * (review of #4018, L3). Until the harness is in the pane — the launcher runs
 * first on tmux, and Herdr detection can take up to a minute — the oracle
 * reports a starting planner as dead, and a second message in that window
 * would close it and launch another.
 */
export const PLANNER_LAUNCH_GRACE_MS = 60_000;

function plannerIsLaunching(sessionName: string, now = Date.now()): boolean {
  const state = getAgentState(sessionName);
  if (!state || (state.status !== 'starting' && state.status !== 'running')) return false;
  const startedAtMs = Date.parse(state.startedAt);
  return Number.isFinite(startedAtMs) && now - startedAtMs < PLANNER_LAUNCH_GRACE_MS;
}

/**
 * Live, not confirmed dead, or launched moments ago: an indeterminate probe
 * never counts as finished, and neither does a planner still starting.
 */
async function plannerIsLive(sessionName: string): Promise<boolean> {
  const verdict = await isAlive(sessionName).catch(
    () => ({ alive: false, reason: 'runtime-indeterminate' }) as const,
  );
  return !isConfirmedDead(verdict) || plannerIsLaunching(sessionName);
}

// ─── Route: GET /api/planning/:issueId/status ────────────────────────────────

const getPlanningStatusRoute = HttpRouter.add(
  'GET',
  '/api/planning/:issueId/status',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/planning/:issueId/status → parts[3] = issueId
    const issueId = parts[3] || '';
    const sessionName = `planning-${issueId.toLowerCase()}`;
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

    return yield* Effect.promise(async () => {
      try {
        const projectPath = await getProjectPath(issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const remoteState = loadRemoteAgentState(sessionName);
        const isRemote = !!remoteState;
        const vmName = remoteState?.vmName ?? '';
        // Review of #3992 (M1): the liveness oracle, on this host's backend — not
        // "a pane exists". A finished planner leaves its Herdr pane behind (and
        // may leave an `exited` agent record), and that residue is not an active
        // session. The same predicate gates the message route, so the dialog and
        // the relaunch decision agree. A probe that could not answer is treated
        // as live, never as a finished planner. A starting planner already runs
        // its launcher in the pane, so the oracle reports it too.
        const plannerLive = isRemote ? false : await plannerIsLive(sessionName);

        const panDir = join(workspacePath, PAN_DIRNAME);
        const panContinueFile = join(panDir, PAN_CONTINUE_FILENAME);
        const hasContinueFile = existsSync(panContinueFile);
        const hasPlanningState = hasContinueFile || await Effect.runPromise(findPlan(workspacePath)) !== null;
        const hasPromptFile = hasPlanningState;
        // hasCompletionMarker means `plan.status === 'proposed'` (gates the
        // dashboard Done button which should hide once the user has approved).
        // planningCompleted means `plan.status` indicates planning has finished
        // (any of proposed/approved/pending/running/completed/blocked).
        const hasCompletionMarker = existsSync(panDir)
          ? await Effect.runPromise(checkPlanStatus(workspacePath, status => status === 'proposed'))
          : false;
        const planningCompleted = existsSync(panDir)
          ? await Effect.runPromise(checkPlanStatus(workspacePath, status => PLANNING_FINISHED_STATUSES.has(status)))
          : false;

        return jsonResponse({
          active: plannerLive,
          sessionName,
          workspacePath: existsSync(workspacePath) ? workspacePath : undefined,
          planningCompleted,
          hasStateFile: hasPlanningState,
          hasPromptFile,
          hasCompletionMarker,
          isRemote,
          vmName: isRemote ? vmName : undefined,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({
          active: false,
          sessionName,
          planningCompleted: false,
          error: msg,
        });
      }
    })
  }),
);

async function claudePlanningSystemPromptFiles(workspacePath: string): Promise<string[]> {
  const files: string[] = [];
  const contextFile = workspaceContextFile(workspacePath);
  try {
    await stat(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());
  return files;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

// ─── Route: POST /api/planning/:issueId/message ──────────────────────────────

const postPlanningMessageRoute = HttpRouter.add(
  'POST',
  '/api/planning/:issueId/message',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/planning/:issueId/message → parts[3] = issueId
    const issueId = parts[3] || '';
    const sessionName = `planning-${issueId.toLowerCase()}`;
    const issueLower = issueId.toLowerCase();

    const body = yield* readJsonBody;
    const { message } = body as { message?: string };
    const eventStore = yield* EventStoreService;

    if (!message) {
      return jsonResponse({ error: 'Message required' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
      try {
        // Determine project path
        const githubCheck = isGitHubIssue(issueId);
        let projectPath = '';

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
        }
        if (!projectPath) {
          const teamPrefix = extractTeamPrefix(issueId);
          const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
          projectPath = projectConfig?.path || '';
        }

        if (!projectPath) {
          return jsonResponse(
            { error: `Could not find project path for ${issueId}. Check projects.yaml.` },
            { status: 404 },
          );
        }

        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const planningDir = join(workspacePath, PAN_DIRNAME);
        if (!existsSync(planningDir)) {
          return jsonResponse(
            { error: 'Planning directory not found', sessionEnded: true },
            { status: 404 },
          );
        }

        // Check if session is remote
        const isRemote = !!loadRemoteAgentState(sessionName);

        // Check if the local planner is live (skip remote for now). Review of
        // #3992 (M1): liveness comes from the oracle, not pane existence — a
        // finished planner's Herdr pane outlives it, and a message delivered to
        // it lands in a dead shell while the planner is never relaunched.
        const paneAlive = isRemote ? false : await plannerIsLive(sessionName);

        if (paneAlive) {
          const delivery = await deliverAgentMessage(sessionName, message, 'planning user message');
          if (!delivery.ok) {
            throw new Error(delivery.failure ?? `delivery via ${delivery.path} failed`);
          }
          await Effect.runPromise(eventStore.append({
            type: 'planning.sync',
            timestamp: new Date().toISOString(),
            payload: { issueId, status: 'running', message: 'User message sent' },
          }));
          return jsonResponse({
            success: true,
            sessionName,
            message: 'Message sent to active session',
          });
        }

        // Session not alive — restart with continuation prompt. Resolve the
        // plan model first, before any side effect: a model that cannot be
        // resolved fails loudly, never falls back to a literal (PAN-4160).
        let msgPlanningModel: string;
        try {
          msgPlanningModel = resolveModel('plan', undefined, loadYamlConfig().config);
        } catch (error: unknown) {
          const cause = error instanceof Error ? error.message : String(error);
          console.error('Cannot relaunch planning session: plan model unresolved:', error);
          return jsonResponse(
            { success: false, error: `No default model configured for the plan role: ${cause}` },
            { status: 500 },
          );
        }

        const outputFile = join(planningDir, 'output.jsonl');
        let conversationLog = '';
        const outputContent = await readFile(outputFile, 'utf-8').catch(() => null);
        if (outputContent) {
          const lines = outputContent.split('\n').filter(line => line.trim());
          const logParts: string[] = [];

          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.type === 'assistant' && json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === 'text') {
                    logParts.push(`**Assistant:**\n${block.text}`);
                  }
                }
              }
            } catch {}
          }
          conversationLog = logParts.join('\n\n');
        }

        const continuationPromptPath = join(planningDir, 'CONTINUATION_PROMPT.md');
        const continuationPrompt = `# Continuation of Planning Session: ${issueId.toUpperCase()}

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files
- Run implementation commands (npm install, docker, etc.)
- Create actual features or functionality

**YOU SHOULD ONLY:**
- Ask clarifying questions
- Explore the codebase to understand context
- Generate planning artifacts (\`.overdeck/continue.json\`, \`.overdeck/spec.vbrief.json\`)
- Present options and tradeoffs

---

## Previous Conversation

${conversationLog}

---

## User's Response

${message}

---

## Your Task

Continue the PLANNING session. Do NOT implement anything.
`;

        await writeFile(continuationPromptPath, continuationPrompt);

        const agentCwd = workspacePath;
        const harnessLaunch = await prepareHarnessLaunch('claude-code');

        if (existsSync(outputFile)) {
          const backupPath = join(planningDir, `output-${Date.now()}.jsonl`);
          await rename(outputFile, backupPath);
        }

        const { getAgentCommand } = await import('../../../../lib/settings.js');
        const msgAgentCmd = getAgentCommand(msgPlanningModel);
        const msgPermissionFlags = getClaudePermissionFlagsString();
        const msgCmdWithArgs =
          msgAgentCmd.args.length > 0
            ? `${msgAgentCmd.command} ${msgAgentCmd.args.join(' ')} ${msgPermissionFlags}`
            : `${msgAgentCmd.command} ${msgPermissionFlags}`;

        const agentStateDir = join(getOverdeckHome(), 'agents', sessionName);
        const launcherScript = join(agentStateDir, 'continuation-launcher.sh');
        await mkdir(agentStateDir, { recursive: true });

        await writeFile(
          launcherScript,
          generateLauncherScript({
            role: 'plan',
            workingDir: agentCwd,
            baseCommand: msgCmdWithArgs,
            extraEnvExports: [harnessLaunch.pathExport],
            appendSystemPromptFiles: await claudePlanningSystemPromptFiles(agentCwd),
            promptInline: `Please read the continuation prompt at ${continuationPromptPath} and continue the planning session.`,
          }),
          { mode: 0o755 },
        );

        // Mark the planner as starting BEFORE anything is closed or launched,
        // with the claude-code harness the continuation runs (the oracle looks
        // for the harness named here). A second message during the launch then
        // reads it as live and is delivered, instead of closing it and
        // launching another (review of #4018, L3).
        const launchStartedAt = new Date().toISOString();
        saveAgentStateSync({
          ...(getAgentState(sessionName)
            ?? { id: sessionName, issueId, workspace: agentCwd, role: 'plan' as const }),
          status: 'starting',
          harness: 'claude-code',
          model: msgPlanningModel,
          startedAt: launchStartedAt,
        });

        // Close whatever the finished planner left — a Herdr pane back at its
        // shell prompt, or a dead tmux session — before the relaunch, as every
        // other relaunch path does. Otherwise a second pane with the same agent
        // id sits next to the residue, and a later stop can close the wrong one.
        await closeAgentPane(sessionName);

        // PAN-3960: the continuation planner launches through the host's
        // terminal backend like every other agent, stamped role=plan.
        const pane = await launchAgentPane({
          issueId,
          cwd: agentCwd,
          agentId: sessionName,
          argv: ['bash', launcherScript],
          env: {
            OVERDECK_AGENT_ID: sessionName,
            OVERDECK_ISSUE_ID: issueId,
            OVERDECK_SESSION_TYPE: 'plan',
          },
          tokens: {
            issue: issueId,
            role: 'plan',
            harness: 'claude-code',
            model: msgPlanningModel,
          },
        }).catch((error: unknown) => {
          // A launch that failed is not a planner starting: drop the grace window.
          const failedState = getAgentState(sessionName);
          if (failedState) saveAgentStateSync({ ...failedState, status: 'error' });
          throw error;
        });

        // The pane is up: record where it landed. `startedAt` stays the launch
        // time, so the grace window still covers the harness starting in it.
        const launchedState = getAgentState(sessionName);
        if (launchedState) {
          saveAgentStateSync({ ...launchedState, status: 'running', backend: pane.backend, paneId: pane.paneId });
        }

        if (pane.backend === 'tmux') {
          try {
            await Effect.runPromise(resizeWindow(sessionName, 200, 50));
          } catch {}
        }

        await Effect.runPromise(eventStore.append({
          type: 'planning.sync',
          timestamp: new Date().toISOString(),
          payload: { issueId, status: 'running', message: 'User message sent' },
        }));

        return jsonResponse({
          success: true,
          sessionName,
          message: 'Planning session restarted in interactive mode',
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error sending planning message:', error);
        return jsonResponse(
          { error: 'Failed to send message: ' + msg },
          { status: 500 },
        );
      }
    })
  }),
);

// ─── Route: DELETE /api/planning/:issueId ────────────────────────────────────

const deletePlanningSessionRoute = HttpRouter.add(
  'DELETE',
  '/api/planning/:issueId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/planning/:issueId → parts[3] = issueId
    const issueId = parts[3] || '';
    const sessionName = `planning-${issueId.toLowerCase()}`;

    return yield* Effect.promise(async () => {
      // PAN-3960: close the planner through the terminal backend — a Herdr pane
      // has no tmux session to kill. Review of #3992 (L2): a close that failed
      // is a failure, not "already stopped" — the planner may still be running.
      const result = await closeAgentPaneDetailed(sessionName);
      if (result.outcome === 'failed') {
        return jsonResponse(
          { success: false, error: `Failed to stop planning session ${sessionName}: ${result.reason}` },
          { status: 500 },
        );
      }
      return result.outcome === 'closed'
        ? jsonResponse({ success: true })
        : jsonResponse({ success: true, alreadyStopped: true });
    });
  }),
);

export const planningRouteLayer = Layer.mergeAll(
  getPlanningStatusRoute,
  postPlanningMessageRoute,
  deletePlanningSessionRoute,
);
