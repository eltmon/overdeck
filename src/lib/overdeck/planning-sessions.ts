import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Duration, Effect, Stream } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { invalidateAgentsCache } from '../../dashboard/server/routes/agents.js';
import { clearReviewStatus } from '../../dashboard/server/review-status.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { getGitHubConfig } from '../../dashboard/server/services/tracker-config.js';
import { cleanupAgentStateDirs } from './workspace-hygiene.js';
import { getAgentState, getProviderAuthMode, saveAgentStateSync } from '../agents.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { appendContinueSessionEntryForIssue } from '../vbrief/lifecycle-io.js';
import { isPlanningComplete, findPlan } from '../vbrief/io.js';
import { extractPrefixSync } from '../issue-id.js';
import { spawnPlanningSession, type PlanningIssue } from '../planning/spawn-planning-session.js';
import { findProjectByTeamSync, resolveProjectFromIssueSync } from '../projects.js';
import { resolveGitHubIssueSync, resolveTrackerTypeSync } from '../tracker-utils.js';
import { killSession, listSessionNames, sessionExists } from '../tmux.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { saveAgentStateAndEmitEventProgram } from '../../dashboard/server/services/agent-projection.js';
import { TrackerApiError } from '../../dashboard/server/services/typed-errors.js';
import type { GitHubClientError, GitHubClientShape, GitHubIssue } from '../../dashboard/server/services/github-client.js';
import { buildChildStoriesFromRally } from './task-generation.js';
import { resolveIssueProjectPathSync } from './issue-reads.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function getIssueDataService() {
  return getSharedIssueService();
}

const START_PLANNING_GITHUB_FETCH_ATTEMPTS = 5;
const START_PLANNING_GITHUB_FETCH_BACKOFF_MS = [250, 500, 750, 1000];

function getGitHubIssueForStartPlanning(
  github: GitHubClientShape,
  owner: string,
  repo: string,
  number: number,
  issueId: string,
  attempt = 1,
): Effect.Effect<GitHubIssue, GitHubClientError> {
  return github.getIssue(owner, repo, number).pipe(
    Effect.catchTag('IssueNotFound', (err) => {
      if (attempt >= START_PLANNING_GITHUB_FETCH_ATTEMPTS) {
        return Effect.fail(new TrackerApiError({
          tracker: 'github',
          message: `could not fetch ${issueId.toUpperCase()} from GitHub after ${START_PLANNING_GITHUB_FETCH_ATTEMPTS} attempts`,
          cause: err,
        }));
      }

      const delayMs = START_PLANNING_GITHUB_FETCH_BACKOFF_MS[
        Math.min(attempt - 1, START_PLANNING_GITHUB_FETCH_BACKOFF_MS.length - 1)
      ] ?? 1000;
      return Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.flatMap(() => getGitHubIssueForStartPlanning(github, owner, repo, number, issueId, attempt + 1)),
      );
    }),
  );
}

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function getGitHubLocalPaths(): Record<string, string> {
  const ghConfig = getGitHubConfig();
  if (!ghConfig) return {};
  const out: Record<string, string> = {};
  for (const r of ghConfig.repos) {
    const localPath = (r as { localPath?: unknown }).localPath;
    if (typeof localPath === 'string') {
      out[`${r.owner}/${r.repo}`] = localPath;
    }
  }
  return out;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

export function startPlanningForIssue(options: {
  id: string;
  body: any;
  eventStore: any;
  linear: any;
  github: any;
  rally: any;
  lifecycle: any;
}) {
  return Effect.gen(function* () {
    const { id, body, eventStore, linear, github, rally, lifecycle } = options;
    const {
      skipWorkspace = false,
      startDocker = false,
      workspaceLocation = 'local',
      shadowMode = false,
      model: modelOverride,
      effort,
      auto = false,
      autoStart = false,
      probe = false,
      harness = 'claude-code',
    } = body as any;
    void skipWorkspace;
    void startDocker;
    const requestedHarness = harness === 'ohmypi' || harness === 'claude-code' || harness === 'codex' ? harness : 'claude-code';

    console.log(`[start-planning] START for ${id}, workspaceLocation=${workspaceLocation}, shadow=${shadowMode}`);

    // TTS announcement so the operator hears the lifecycle without watching the dashboard
    emitActivityEntrySync({
      source: 'plan',
      level: 'info',
      message: `${id} planning agent starting`,
      issueId: id,
    });
    emitActivityTtsSync({
      utterance: `Planning agent starting for ${id}`,
      priority: 2,
      issueId: id,
      source: 'planning-agent',
      eventType: 'planning.started',
    });

    // Clear agents cache so the next dashboard poll sees the new planning agent
    invalidateAgentsCache();

    // Check if a work agent is already running
    const issueLowerForCheck = id.toLowerCase();
    const tmuxSessions = yield* listSessionNames();
    const workAgentSession = tmuxSessions.find((s: string) => s === `agent-${issueLowerForCheck}`);
    if (workAgentSession) {
      return jsonResponse({
        error: `Cannot start planning: work agent already running for ${id.toUpperCase()}`,
        hint: 'Stop the agent first or use the terminal view to interact with it',
        existingSession: workAgentSession,
      }, { status: 409 });
    }

    const trackerTypeForIssue = resolveTrackerTypeSync(id);
    const githubCheck = isGitHubIssue(id);

    let issue: {
      id: string;
      identifier: string;
      title: string;
      description: string;
      url: string;
      source: 'linear' | 'github' | 'rally';
      comments?: Array<{ author: string; body: string; createdAt: string }>;
      artifactType?: string;
      childStories?: Array<{ ref: string; title: string; status: string; description: string }>;
    };
    let newStateName = 'In Planning';

    if (trackerTypeForIssue === 'github' && githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      const ghIssue = yield* getGitHubIssueForStartPlanning(github, owner, repo, number, id);

      const ghConfig = getGitHubConfig();
      const repoConfig = ghConfig?.repos.find((r: any) => r.owner === owner && r.repo === repo);
      const prefix = repoConfig?.prefix || repo.toUpperCase();

      const ghComments = yield* github.getComments(owner, repo, number, 50).pipe(
        Effect.map((cs: any[]) => cs.map((c) => ({ author: c.user, body: c.body, createdAt: c.createdAt }))),
        Effect.catch(() => Effect.succeed([] as Array<{ author: string; body: string; createdAt: string }>)),
      );

      issue = {
        id: `github-${owner}-${repo}-${number}`,
        identifier: `${prefix}-${number}`,
        title: ghIssue.title,
        description: ghIssue.body || '',
        url: ghIssue.htmlUrl,
        source: 'github',
        comments: ghComments.length > 0 ? ghComments : undefined,
      };

      // Add "planning" label (ensure it exists, then apply to issue)
      yield* lifecycle.addLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));

    } else if (trackerTypeForIssue === 'rally') {
      const rallyIssue = yield* rally.getIssue(id);

      // Fetch child stories for Rally Features
      let childStories: Array<{ ref: string; title: string; status: string; description: string }> = [];
      if (rallyIssue.artifactType?.includes('PortfolioItem')) {
        const children = yield* rally.getChildIssues(id).pipe(
          Effect.catch(() => Effect.succeed([] as readonly { ref: string; title: string; status: string; description: string }[])),
        );
        childStories = buildChildStoriesFromRally(children);
      }

      issue = {
        id: rallyIssue.id,
        identifier: rallyIssue.ref,
        title: rallyIssue.title,
        description: rallyIssue.description || '',
        url: rallyIssue.url,
        source: 'rally',
        artifactType: rallyIssue.artifactType,
        childStories: childStories.length > 0 ? childStories : undefined,
      };

    } else {
      // Linear
      const linearIssue = yield* linear.getIssue(id);

      issue = {
        id: linearIssue.id,
        identifier: linearIssue.identifier,
        title: linearIssue.title,
        description: linearIssue.description || '',
        url: linearIssue.url,
        source: 'linear',
      };
    }

    const issuePrefix = extractPrefixSync(issue.identifier) ?? issue.identifier.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issue.identifier.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const sessionName = `planning-${issueLower}`;

    // PAN-1048: Write preliminary agent state BEFORE lifecycle.transitionTo so
    // reactive Cloister sees role: 'plan' for this issue the moment it observes
    // the in_planning transition. Writing state.json AFTER transitionTo opened
    // a small race window where Cloister's onIssueStateChange could run
    // activeRoleRunExists() and find no plan agent, then spawn a duplicate
    // planning run via spawnRun (session name 'agent-pan-X-plan') alongside
    // the route's own planning-pan-x session.
    // state.json must declare role: 'plan' — parseAgentState() drops state files
    // lacking a valid role, so writing the legacy type/agentPhase shape would
    // make the dashboard discard this planning session on the next startup scan.
    const agentStateDir = join(homedir(), '.overdeck', 'agents', sessionName);
    yield* Effect.promise(() => mkdir(agentStateDir, { recursive: true }));
    yield* Effect.promise(() => {
      saveAgentStateSync({
        id: sessionName,
        issueId: issue.identifier,
        workspace: workspacePath,
        status: 'starting',
        startedAt: new Date().toISOString(),
        role: 'plan',
        model: '',
        auto: auto === true,
      });
      return Promise.resolve();
    });

    // Transition to "In Planning" state — emits issue.transitioned which
    // reactive Cloister consumes. State.json was written above so the
    // observer can see role: 'plan' before mapping in_planning → plan role.
    // PAN-1994: call for ALL tracker types (not just linear). For GitHub
    // issues this cleans up stale labels (merged, verifying-on-main, etc.)
    // left by a prior pipeline cycle when re-planning starts.
    yield* lifecycle.transitionTo(id, 'in_planning').pipe(Effect.catch(() => Effect.void));

    yield* eventStore.append({
      type: 'workspace.created',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, workspacePath },
    });
    yield* eventStore.append({
      type: 'planning.started',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, sessionName, harness: requestedHarness },
    });
    // PAN-1048: lifecycle.transitionTo(id, 'in_planning') above already emits
    // issue.transitioned with state 'in_planning'. The redundant
    // issue.statusChanged emit (formerly broadcasting canonicalStatus
    // 'in_progress', not 'in_planning') was a second source of truth that
    // raced with reactive Cloister: 'in_progress' maps to the work role,
    // so Cloister could spawn a work agent while the planning agent was
    // still being created. Removed in favor of the single transitionTo emit.

    try { getIssueDataService().patchIssue(issue.identifier, { status: newStateName, canonicalStatus: 'in_planning' }); } catch { /* non-fatal */ }

    // SSE stream: await spawnPlanningSession and stream progress events
    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const sendEvent = (data: Record<string, unknown>) => {
          if (closed) {
            console.warn(`[start-planning] SSE event dropped (stream closed):`, JSON.stringify(data).slice(0, 200));
            return;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (err: any) {
            console.error(`[start-planning] SSE enqueue failed:`, err.message);
            closed = true;
          }
        };

        console.log(`[start-planning] SSE stream opened for ${id}`);

        // Send initial metadata
        sendEvent({
          type: 'started',
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            newState: newStateName,
            source: issue.source,
          },
          workspace: { path: workspacePath },
          sessionName,
        });

        try {
          let effectiveHarness = requestedHarness;
          if (typeof modelOverride === 'string' && modelOverride.trim()) {
            const decision = canUseHarnessSync(requestedHarness, modelOverride.trim(), await getProviderAuthMode(modelOverride.trim()));
            if (!decision.allowed) effectiveHarness = 'claude-code';
          }
          const result = await spawnPlanningSession({
            issue: issue as PlanningIssue,
            workspacePath,
            projectPath,
            sessionName,
            workspaceLocation: workspaceLocation as 'local' | 'remote',
            startDocker: body.startDocker,
            shadowMode,
            model: modelOverride || undefined,
            harness: effectiveHarness,
            effort: effort || undefined,
            auto: auto === true,
            probe: probe === true,
            autoSpawnOnFinalize: autoStart === true,
            onProgress: (event) => {
              console.log(`[start-planning] Progress: step=${event.step} label="${event.label}" status=${event.status} detail="${event.detail}"`);
              sendEvent({ type: 'progress', ...event });
            },
          });

          if (result.success) {
            console.log(`[start-planning] SSE complete for ${id}, sessionName=${sessionName}`);
            sendEvent({ type: 'complete', sessionName });
          } else {
            console.error(`[start-planning] SSE error for ${id}: ${result.error}`);
            sendEvent({ type: 'error', error: result.error });
          }
        } catch (streamErr: any) {
          console.error(`[start-planning] SSE stream exception for ${id}:`, streamErr);
          sendEvent({ type: 'error', error: streamErr.message || 'Unexpected error during setup' });
        }

        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });
}

export function abortPlanningForIssue(options: {
  id: string;
  body: any;
  lifecycle: any;
  linear: any;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { id, body, lifecycle, linear, eventStore } = options;
    const { deleteWorkspace } = body as any;
    const githubCheck = isGitHubIssue(id);

    let revertedState = 'Todo';
    let issueIdentifier: string | undefined;
    let sessionName: string = `planning-${id.toLowerCase()}`;

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      issueIdentifier = id;
      sessionName = `planning-${id.toLowerCase()}`;
      // Remove planning label via IssueLifecycle
      yield* lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));
      revertedState = 'Todo';
    } else {
      // Resolve issue identifier and session name via LinearClient, then transition to 'open' (Todo)
      const linearIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));

      if (linearIssue) {
        issueIdentifier = linearIssue.identifier;
        sessionName = `planning-${linearIssue.identifier.toLowerCase()}`;
      }

      yield* lifecycle.transitionTo(id, 'open').pipe(Effect.catch(() => Effect.void));
      revertedState = 'Todo';
    }

    // Kill tmux sessions
    yield* killSession(sessionName).pipe(Effect.ignore);
    yield* killSession(`planning-${id.toLowerCase()}`).pipe(Effect.ignore);

    // Clean up agent state files (non-fatal, so absorbed inside the promise)
    const agentStateDir = join(homedir(), '.overdeck', 'agents', sessionName);
    const workAgentStateDir = issueIdentifier
      ? join(homedir(), '.overdeck', 'agents', `agent-${issueIdentifier.toLowerCase()}`)
      : join(homedir(), '.overdeck', 'agents', `agent-${id.toLowerCase()}`);

    yield* Effect.promise(() =>
      cleanupAgentStateDirs([agentStateDir, workAgentStateDir]).catch((cleanupErr: unknown) => {
        console.log('[abort-planning] Warning: Could not clean up agent state:', cleanupErr);
      })
    );

    let workspaceDeleted = false;
    let workspaceError: string | undefined;

    if (deleteWorkspace && issueIdentifier) {
      const wipeResult = yield* Effect.promise(async (): Promise<{ deleted: boolean; error?: string }> => {
        try {
          const projectPath = resolveIssueProjectPathSync(issueIdentifier!) || undefined;

          if (projectPath) {
            const featureWorkspacePath = join(projectPath, 'workspaces', `feature-${issueIdentifier!.toLowerCase()}`);
            const plainWorkspacePath = join(projectPath, 'workspaces', issueIdentifier!.toLowerCase());
            const workspacePath = existsSync(featureWorkspacePath) ? featureWorkspacePath : plainWorkspacePath;

            if (existsSync(workspacePath)) {
              await execFileAsync('pan', ['workspace', 'destroy', issueIdentifier!.toLowerCase(), '--force'], {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
              });
              return { deleted: true };
            } else {
              return { deleted: false, error: 'Workspace not found' };
            }
          } else {
            return { deleted: false, error: 'Could not determine project path' };
          }
        } catch (err: any) {
          return { deleted: false, error: err.message };
        }
      });
      workspaceDeleted = wipeResult.deleted;
      workspaceError = wipeResult.error;
    }

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier || id, status: revertedState, canonicalStatus: 'todo' },
    });
    yield* eventStore.append({
      type: 'workspace.aborted',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier || id, sessionName },
    });
    try { getIssueDataService().patchIssue(issueIdentifier || id, { status: revertedState, canonicalStatus: 'todo' }); } catch { /* non-fatal */ }

    // Clear agents cache so the dashboard stops showing the planning agent as active
    invalidateAgentsCache();

    return jsonResponse({
      success: true,
      issueId: id,
      revertedState,
      sessionKilled: true,
      workspaceDeleted,
      workspacePreserved: !deleteWorkspace && !workspaceDeleted,
      workspaceError,
    });
  });
}

export function restartFromPlan(options: {
  id: string;
  lifecycle: any;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { id, lifecycle, eventStore } = options;
    const issueLower = id.toLowerCase();

    // 1. Resolve workspace path
    const projectPath = resolveIssueProjectPathSync(id);

    const workspacePath = projectPath
      ? join(projectPath, 'workspaces', `feature-${issueLower}`)
      : '';

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    // 2. Kill work agent tmux session and remove agent state dir
    yield* Effect.promise(async () => {
      const workAgentSession = `agent-${issueLower}`;
      try {
        if (await Effect.runPromise(sessionExists(workAgentSession))) {
          await Effect.runPromise(killSession(workAgentSession));
          console.log(`[restart-from-plan] Killed work agent session ${workAgentSession}`);
        }
      } catch { /* non-fatal */ }
      const agentStateDir = join(homedir(), '.overdeck', 'agents', `agent-${issueLower}`);
      if (existsSync(agentStateDir)) {
        try {
          await rm(agentStateDir, { recursive: true, force: true });
          console.log(`[restart-from-plan] Removed agent state dir ${agentStateDir}`);
        } catch { /* non-fatal */ }
      }
    });

    // 2b. Clean up stale specialist artifacts (.pan/ and feedback) that survive git resets
    yield* Effect.promise(async () => {
      const dirsToClean = [
        join(workspacePath, '.pan', 'review'),
        join(workspacePath, '.pan', 'prompts'),
        join(workspacePath, '.pan', 'events'),
        join(workspacePath, '.pan', 'feedback'),
      ];
      for (const dir of dirsToClean) {
        if (existsSync(dir)) {
          try {
            await rm(dir, { recursive: true, force: true });
            console.log(`[restart-from-plan] Cleaned ${dir}`);
          } catch { /* non-fatal */ }
        }
      }
    });

    // 3. Find the planning commit and reset to it.
    //
    // Planning commits come from two sources:
    //   - complete-planning endpoint: "Complete planning for PAN-XXX"
    //   - agent start flow: "chore: planning artifacts for PAN-XXX before agent start"
    // Fall back to finding the commit that added `.pan/spec.vbrief.json`.
    //
    // If no planning commit is found, we DO NOT auto-clean. The previous
    // behaviour used a broad git-clean fallback that
    // silently destroyed `.devcontainer/`, `.env`, `node_modules/`, and
    // anything else untracked — see PAN-955/956. The fix is to surface a
    // structured error pointing the user at `pan workspace deep-clean <id>`,
    // which they invoke from a TTY after seeing what would be deleted.
    type ResetOutcome =
      | { success: true; commit: string; method: string }
      | {
          success: false;
          code: 'DANGEROUS_OP_BLOCKED';
          operation: 'git_clean';
          reason: string;
          recovery: string;
        }
      | { success: false; error: string };

    const resetResult = yield* Effect.promise(async (): Promise<ResetOutcome> => {
      try {
        const { runGitResetHard } = await import('../safety/dangerous-git-ops.js');

        async function findPlanningCommit(grep: string, label: string): Promise<{ sha: string; method: string } | null> {
          try {
            const { stdout } = await execAsync(
              `git log --grep="${grep.replace(/"/g, '\\"')}" --format=%H -1`,
              { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 },
            );
            const sha = stdout.trim();
            return sha ? { sha, method: label } : null;
          } catch {
            return null;
          }
        }

        const found =
          (await findPlanningCommit(`Complete planning for ${id}`, 'complete-planning message')) ??
          (await findPlanningCommit(`chore: planning artifacts for ${id}`, 'agent-start message')) ??
          (await (async () => {
            try {
              const { stdout } = await execAsync(
                `git log --diff-filter=A --format=%H -1 -- .pan/spec.vbrief.json`,
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 },
              );
              const sha = stdout.trim();
              return sha ? { sha, method: '.pan/spec.vbrief.json add' } : null;
            } catch {
              return null;
            }
          })());

        if (!found) {
          // No tracked planning state to reset to. Refuse to auto-clean —
          // the user has to opt in via `pan workspace deep-clean <id>`.
          return {
            success: false,
            code: 'DANGEROUS_OP_BLOCKED',
            operation: 'git_clean',
            reason:
              `restart-from-plan could not find a planning commit for ${id}. The previous ` +
              `behaviour was to auto-clean untracked files, which silently destroyed .devcontainer/, ` +
              `.env, and other regenerable artifacts. That auto-clean is no longer allowed.`,
            recovery:
              `Run \`pan workspace deep-clean ${issueLower}\` from a terminal — it will list every ` +
              `untracked file/dir before deleting anything and ask you to confirm. After that, retry ` +
              `restart-from-plan.`,
          };
        }

        await Effect.runPromise(runGitResetHard({
          workspacePath,
          ref: found.sha,
          reason: `restart-from-plan ${id} (${found.method})`,
        }));
        console.log(`[restart-from-plan] Reset branch to planning commit ${found.sha} for ${id}`);
        return { success: true, commit: found.sha, method: found.method };
      } catch (err: any) {
        return { success: false, error: err.message || 'Git reset failed' };
      }
    });

    if (!resetResult.success) {
      if ('code' in resetResult && resetResult.code === 'DANGEROUS_OP_BLOCKED') {
        return jsonResponse(
          {
            success: false,
            error: resetResult.reason,
            code: resetResult.code,
            operation: resetResult.operation,
            recovery: resetResult.recovery,
          },
          { status: 409 },
        );
      }
      const errMsg = 'error' in resetResult ? resetResult.error : 'reason' in resetResult ? resetResult.reason : 'unknown error';
      return jsonResponse({ success: false, error: errMsg }, { status: 400 });
    }

    // 4. Reset specialist pipeline states
    clearReviewStatus(id.toUpperCase());

    // 5. Append restart entry to continue file (lifecycle-aware)
    yield* Effect.promise(async () => {
      const upperId = id.toUpperCase();
      try {
        appendContinueSessionEntryForIssue(projectPath, upperId, {
          reason: 'resume',
          note: `Restarted from plan — branch reset to planning commit ${resetResult.commit}. Specialist states cleared.`,
        });
      } catch {
        // Non-fatal: continue file may not exist yet
      }
    });

    // 6. Move issue to In Progress
    yield* lifecycle.transitionTo(id, 'in_progress').pipe(Effect.catch(() => Effect.void));

    // 7. Emit events
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    const restartAgentState = yield* getAgentState(`agent-${issueLower}`);
    if (restartAgentState) {
      yield* saveAgentStateAndEmitEventProgram(restartAgentState, {
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: `agent-${issueLower}`, issueId: restartAgentState.issueId },
      });
    }
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'In Progress', canonicalStatus: 'in_progress' },
    });
    yield* eventStore.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        issueId: id,
        status: {
          issueId: id,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
        },
      },
    });
    try { getIssueDataService().patchIssue(id, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} restarted from plan. Branch reset to ${resetResult.commit}`,
      issueId: id,
      newState: 'In Progress',
      planningCommit: resetResult.commit,
    });
  });
}

export function getPlanningState(id: string) {
  return Effect.gen(function* () {
    const issueLower = id.toLowerCase();

    const projectPath = resolveIssueProjectPathSync(id);

    const workspacePath = projectPath
      ? join(projectPath, 'workspaces', `feature-${issueLower}`)
      : '';
    const planPath = workspacePath ? yield* findPlan(workspacePath) : null;
    const hasPlan = planPath !== null;
    // planningComplete now means "plan.status indicates planning has finished" —
    // any of proposed/approved/pending/running/completed/blocked.
    // It's the definitive signal for "tasks have been generated from this plan."
    const planningComplete = workspacePath ? yield* isPlanningComplete(workspacePath) : false;

    const hasTasks = !!planningComplete;

    return jsonResponse({
      hasPlan,
      hasTasks,
      beadsCount: 0,  // Deprecated — use hasTasks. Kept for backward compat.
      planningComplete,
      workspacePath,
    });
  });
}
