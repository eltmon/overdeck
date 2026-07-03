import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { ensureSessionContextBriefingFile } from '../../../../lib/briefing-freshness.js';
import { getClaudePermissionFlagsStringSync } from '../../../../lib/claude-permissions.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../../../../lib/config-yaml.js';
import { workspaceContextFile } from '../../../../lib/context-layers/layers.js';
import { extractPrefixSync } from '../../../../lib/issue-id.js';
import { generateLauncherScriptSync } from '../../../../lib/launcher-generator.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../../lib/pan-dir/types.js';
import { extractTeamPrefix, findProjectByTeamSync } from '../../../../lib/projects.js';
import { loadRemoteAgentState } from '../../../../lib/remote/remote-agents.js';
import { createSession, killSession, resizeWindow, sendKeys, sessionExists } from '../../../../lib/tmux.js';
import { findPlan, readPlan } from '../../../../lib/vbrief/io.js';
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
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];

    return yield* Effect.promise(async () => {
      try {
        const projectPath = await getProjectPath(issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const remoteState = loadRemoteAgentState(sessionName);
        const isRemote = !!remoteState;
        const vmName = remoteState?.vmName ?? '';
        const { getAgentStateSync } = await import('../../../../lib/agents.js');
        const agentState = getAgentStateSync(sessionName);
        const agentStarting = agentState?.status === 'starting';

        let tmuxSessionAlive = false;
        if (!isRemote) {
          try {
            tmuxSessionAlive = await Effect.runPromise(sessionExists(sessionName));
          } catch {}
        }

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
          active: tmuxSessionAlive || agentStarting,
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
          const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
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

        // Check if local session exists (skip remote for now)
        let tmuxSessionAlive = false;
        if (!isRemote) {
          try {
            tmuxSessionAlive = await Effect.runPromise(sessionExists(sessionName));
          } catch {}
        }

        if (tmuxSessionAlive) {
          await Effect.runPromise(sendKeys(sessionName, message, 'planning user message'));
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

        // Session not alive — restart with continuation prompt
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
- Generate planning artifacts (\`.pan/continue.json\`, \`.pan/spec.vbrief.json\`)
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

        if (existsSync(outputFile)) {
          const backupPath = join(planningDir, `output-${Date.now()}.jsonl`);
          await rename(outputFile, backupPath);
        }

        const { getAgentCommandSync } = await import('../../../../lib/settings.js');
        let msgPlanningModel = 'claude-sonnet-5';
        try {
          msgPlanningModel = resolveModel('plan', undefined, loadYamlConfig().config);
        } catch { /* fall back to default */ }
        const msgAgentCmd = getAgentCommandSync(msgPlanningModel);
        const msgPermissionFlags = getClaudePermissionFlagsStringSync();
        const msgCmdWithArgs =
          msgAgentCmd.args.length > 0
            ? `${msgAgentCmd.command} ${msgAgentCmd.args.join(' ')} ${msgPermissionFlags}`
            : `${msgAgentCmd.command} ${msgPermissionFlags}`;

        const launcherScript = join(agentStateDir, 'continuation-launcher.sh');
        await mkdir(agentStateDir, { recursive: true });

        await writeFile(
          launcherScript,
          generateLauncherScriptSync({
            role: 'plan',
            workingDir: agentCwd,
            baseCommand: msgCmdWithArgs,
            appendSystemPromptFiles: await claudePlanningSystemPromptFiles(agentCwd),
            promptInline: `Please read the continuation prompt at ${continuationPromptPath} and continue the planning session.`,
          }),
          { mode: 0o755 },
        );

        await Effect.runPromise(createSession(sessionName, agentCwd, `bash '${launcherScript}'`));

        try {
          await Effect.runPromise(resizeWindow(sessionName, 200, 50));
        } catch {}

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
      try {
        await Effect.runPromise(killSession(sessionName));
        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        // tmux reports "can't find session" when the session is already gone — treat as success.
        if (/can't find session|session not found|no session found/i.test(msg)) {
          return jsonResponse({ success: true, alreadyStopped: true });
        }
        console.error(`[delete-planning] kill-session failed for ${sessionName}:`, msg);
        return jsonResponse(
          { error: 'Failed to stop planning: ' + msg },
          { status: 500 },
        );
      }
    });
  }),
);

export const planningRouteLayer = Layer.mergeAll(
  getPlanningStatusRoute,
  postPlanningMessageRoute,
  deletePlanningSessionRoute,
);
