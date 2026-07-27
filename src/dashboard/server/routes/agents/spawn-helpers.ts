import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Role } from '@overdeck/contracts';
import { Effect } from 'effect';

import { buildChildEnvWithoutTmuxSync } from '../../../../lib/child-env.js';
import {
  saveAgentState,
  saveAgentStateSync,
} from '../../../../lib/agents.js';
import type { AgentState } from '../../../../lib/agents/agent-state.js';
import type { RemoteWorkspaceMetadata } from '../../../../lib/remote/interface.js';
import { jsonResponse } from '../../http-helpers.js';
import { saveAgentStateAndEmitEventProgram } from '../../services/agent-projection.js';
import {
  appendAgentLifecycleLog,
  buildPanStartArgs,
  emitStartAgentPhase,
  execAsync,
  execFileAsync,
  getIssueDataService,
  invalidateAgentsCache,
  updateRegistryForAgentStart,
  type SpawnGuardrailDecision,
} from './shared.js';

type LifecycleTransition = {
  transitionTo: (
    issueId: string,
    status: 'in_progress',
  ) => Effect.Effect<unknown, unknown, never>;
};

type EventStoreAppend = {
  append: (event: {
    type: 'issue.statusChanged';
    timestamp: string;
    payload: { issueId: string; status: 'In Progress'; canonicalStatus: 'in_progress' };
  }) => Effect.Effect<unknown, unknown, never>;
};

type SpawnPanCommand = (args: string[], cwd?: string) => Promise<string>;

type PlaceholderHarness = 'claude-code' | 'ohmypi' | 'codex' | 'acp' | null;

export function buildAgentStartPlaceholder(input: {
  agentSessionName: string;
  issueId: string;
  workspacePath: string;
  role: Role;
  effectiveHarness: PlaceholderHarness;
  startedBy: string;
  allowHost: boolean;
  startedAt: string;
}) {
  const state: AgentState = {
    id: input.agentSessionName,
    issueId: input.issueId,
    workspace: input.workspacePath,
    role: input.role,
    ...(input.effectiveHarness ? { harness: input.effectiveHarness } : {}),
    model: 'pending-work-spawn',
    status: 'starting',
    startedAt: input.startedAt,
    startedBy: input.startedBy,
    hostOverride: input.allowHost || undefined,
  };
  return {
    state,
    event: {
      type: 'agent.started' as const,
      timestamp: input.startedAt,
      payload: {
        agentId: input.agentSessionName,
        issueId: input.issueId,
        agent: {
          id: input.agentSessionName,
          issueId: input.issueId,
          workspace: input.workspacePath,
          status: 'starting' as const,
          startedAt: input.startedAt,
          role: input.role,
          startedBy: input.startedBy,
          ...(input.effectiveHarness ? { runtime: input.effectiveHarness } : {}),
        },
      },
    },
  };
}

export function buildContainerStartState(input: {
  agentSessionName: string;
  issueId: string;
  workspacePath: string;
  role: Role;
  effectiveHarness: PlaceholderHarness;
  startedBy: string;
  allowHost: boolean;
  status: 'starting' | 'error';
  startedAt: string;
}): AgentState {
  return {
    id: input.agentSessionName,
    issueId: input.issueId,
    ...(input.effectiveHarness ? { harness: input.effectiveHarness } : {}),
    model: 'pending-container-start',
    status: input.status,
    startedAt: input.startedAt,
    workspace: input.workspacePath,
    role: input.role,
    startedBy: input.startedBy,
    hostOverride: input.allowHost || undefined,
  };
}

export async function requestWorkStartAfterContainers(input: {
  args: string[];
  workspacePath: string;
  spawnPanCommand: SpawnPanCommand;
  markWorkStartAccepted: () => Promise<void>;
  updateIssueStatus: () => Promise<void>;
}): Promise<string> {
  const activityId = await input.spawnPanCommand(input.args, input.workspacePath);
  await input.markWorkStartAccepted();
  await input.updateIssueStatus();
  return activityId;
}

export function handleRemoteAgentSpawn(input: {
  issueId: string;
  workspacePath: string;
  workspaceMetadata: RemoteWorkspaceMetadata;
  spawnModel: string;
  startedBy: string;
  projectPath: string;
  spawnGuardrails: SpawnGuardrailDecision;
  lifecycle: LifecycleTransition;
}) {
  return Effect.gen(function* () {
    const {
      issueId,
      workspacePath,
      workspaceMetadata,
      spawnModel,
      startedBy,
      projectPath,
      spawnGuardrails,
      lifecycle,
    } = input;

    const { spawnRemoteAgent, checkRemoteSpendCap } = yield* Effect.promise(() => import('../../../../lib/remote/remote-agents.js'));
    const { createFlyProviderFromConfig } = yield* Effect.promise(() => import('../../../../lib/remote/index.js'));
    const { loadConfigSync: loadPanConfig } = yield* Effect.promise(() => import('../../../../lib/config.js'));
    const panConfig = loadPanConfig();
    const spendCap = checkRemoteSpendCap(panConfig);
    if (!spendCap.allowed) {
      return jsonResponse({ error: spendCap.message }, { status: 429 });
    }
    const fly = createFlyProviderFromConfig(panConfig.remote);
    yield* Effect.promise(() => fly.syncAllCredentials(workspaceMetadata.vmName));

    const { buildWorkAgentPrompt, getTrackerContext } = yield* Effect.promise(() => import('../../../../lib/cloister/work-agent-prompt.js'));
    const trackerContext = yield* Effect.promise(() => getTrackerContext(issueId, workspacePath));
    const agentPrompt = yield* Effect.promise(() => buildWorkAgentPrompt({
      issueId,
      env: 'REMOTE',
      workspacePath: '/workspace',
      skipDynamicContext: true,
      trackerContext,
    }));

    emitStartAgentPhase(issueId, 'spawn', 'start', 'starting remote work agent', {
      workspacePath,
      vmName: workspaceMetadata.vmName,
    });
    const state = yield* Effect.promise(() => spawnRemoteAgent({
      issueId,
      workspace: workspaceMetadata,
      prompt: agentPrompt,
      model: spawnModel,
      startedBy,
      tier: fly.getResiliencyTier(),
    }));

    // Write canonical state.json so activeRoleRunExists() sees this remote
    // work agent as active before we emit the lifecycle transition below.
    // spawnRemoteAgent only writes remote-state.json; without state.json the
    // Cloister duplicate-spawn guard misses the in-flight remote agent and
    // would spawn a second local work run when in_progress is emitted.
    yield* saveAgentState({
      id: state.id,
      issueId: state.issueId,
      workspace: workspacePath,
      role: 'work',
      model: spawnModel,
      status: 'starting',
      startedAt: state.startedAt,
      harness: 'claude-code',
      startedBy,
    });
    updateRegistryForAgentStart(state.issueId, workspacePath, state.id);

    // PAN-1048: lifecycle.transitionTo() is the single source of issue.transitioned.
    // The redundant issue.statusChanged emit was racing with reactive Cloister:
    // Cloister mapped 'in_progress' → 'work' role and tried to spawn a second
    // run while activeRoleRunExists() still saw no state.json for the
    // in-flight spawn above. state.json is now written before this emit.
    yield* Effect.promise(() => Effect.runPromise(
      lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
    ));

    // PAN-1048 review feedback 003: emit a contract-compliant agent.started
    // event. The reducer writes event.payload.agent into agentsById keyed by
    // event.payload.agentId — the previous shape ({ agentId: issueId, issueId })
    // omitted .agent and used the issue ID as the key, inserting `undefined`
    // into the read model and breaking dashboard consumers.
    //
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram({
      id: state.id,
      issueId: state.issueId,
      workspace: workspacePath,
      role: 'work',
      model: spawnModel,
      status: state.status,
      startedAt: state.startedAt,
      harness: 'claude-code',
      startedBy,
    }, {
      type: 'agent.started',
      timestamp: new Date().toISOString(),
      payload: {
        agentId: state.id,
        issueId: state.issueId,
        agent: {
          id: state.id,
          issueId: state.issueId,
          role: 'work' as const,
          model: spawnModel,
          status: state.status,
          startedAt: state.startedAt,
          lastActivity: state.lastActivity,
          startedBy,
        },
      },
    });
    emitStartAgentPhase(issueId, 'spawn', 'success', 'remote work agent spawn requested', {
      agentId: state.id,
      vmName: workspaceMetadata.vmName,
    });
    try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      message: `Starting remote agent for ${issueId}`,
      remote: true,
      vmName: workspaceMetadata.vmName,
      agentId: state.id,
      projectPath,
      guardrails: spawnGuardrails,
    });
  });
}

export function handleContainerOrchestration(input: {
  issueId: string;
  workspacePath: string;
  devScript: string;
  agentSessionName: string;
  role: Role;
  effectiveHarness: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | null;
  startedBy: string;
  allowHost: boolean;
  spawnModel: string;
  spawnGuardrails: SpawnGuardrailDecision;
  projectPath: string;
  eventStore: EventStoreAppend;
  spawnPanCommand: SpawnPanCommand;
  markWorkStartAccepted: () => Promise<void>;
  updateIssueStatus: () => Promise<void>;
}) {
  return Effect.gen(function* () {
    const {
      issueId,
      workspacePath,
      devScript,
      agentSessionName,
      role,
      effectiveHarness,
      startedBy,
      allowHost,
      spawnModel,
      spawnGuardrails,
      projectPath,
      eventStore,
      spawnPanCommand,
      markWorkStartAccepted,
      updateIssueStatus,
    } = input;

    if (existsSync(workspacePath) && existsSync(devScript)) {
      let dockerRunning = false;
      try {
        yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
        dockerRunning = true;
      } catch {}

      if (dockerRunning) {
        const getComposeProjectName = async (id: string, wPath: string): Promise<string> => {
          const featureFolder = `feature-${id.toLowerCase()}`;
          const expected = `overdeck-${featureFolder}`;
          const validate = (value: string, devPath: string): string => {
            if (value !== expected) {
              throw new Error(`Invalid COMPOSE_PROJECT_NAME in ${devPath}: expected ${expected}`);
            }
            return value;
          };

          const devScriptPaths = [join(wPath, '.devcontainer', 'dev'), join(wPath, 'dev')];
          for (const devPath of devScriptPaths) {
            try {
              if (existsSync(devPath)) {
                const content = await readFile(devPath, 'utf-8');
                const match = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
                if (match) return validate(`${match[1]}${featureFolder}`, devPath);
                const literalMatch = content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/);
                if (literalMatch) return validate(literalMatch[1], devPath);
              }
            } catch (error) {
              if (error instanceof Error && error.message.startsWith('Invalid COMPOSE_PROJECT_NAME')) throw error;
            }
          }
          return expected;
        };

        let featureName: string;
        try {
          featureName = yield* Effect.promise(() => getComposeProjectName(issueId, workspacePath));
        } catch (error) {
          return jsonResponse({
            success: false,
            blocked: true,
            skipped: true,
            error: error instanceof Error ? error.message : String(error),
          }, { status: 422 });
        }
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_container_check', {
          issueId,
          featureName,
          workspacePath,
        }));
        let containersReady = false;

        try {
          const { stdout: existing } = yield* Effect.promise(() => execFileAsync(
            'docker',
            ['ps', '--filter', `name=${featureName}`, '--format', '{{.Names}}|{{.Status}}'],
            { encoding: 'utf-8' }
          ));
          const runningContainers = existing.trim().split('\n').filter(Boolean);
          const allHealthy = runningContainers.length > 0 && runningContainers.every(line => {
            const status = line.split('|')[1] || '';
            return status.includes('Up') && (!status.includes('(') || status.includes('(healthy)'));
          });
          if (allHealthy) containersReady = true;
        } catch {}

        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_container_check_result', {
          issueId,
          featureName,
          containersReady,
        }));

        if (!containersReady && !allowHost) {
          const earlyAgentId = agentSessionName;
          const earlyStateDir = join(homedir(), '.overdeck', 'agents', earlyAgentId);
          yield* Effect.promise(() => mkdir(earlyStateDir, { recursive: true }));
          saveAgentStateSync(buildContainerStartState({
            agentSessionName: earlyAgentId,
            issueId,
            workspacePath,
            role,
            effectiveHarness,
            startedBy,
            allowHost,
            status: 'starting',
            startedAt: new Date().toISOString(),
          }));
          updateRegistryForAgentStart(issueId, workspacePath, earlyAgentId);
          yield* Effect.promise(() => appendAgentLifecycleLog(earlyAgentId, 'agent.start_waiting_for_containers', {
            issueId,
            featureName,
            workspacePath,
            role,
          }));

              const containerActivityId = `containers-${Date.now()}`;

              // Start containers in background and spawn agent when ready
              (async () => {
                try {
                  const containerUid = process.getuid?.() ?? 1000;
                  const containerGid = process.getgid?.() ?? 1000;
                  await appendAgentLifecycleLog(earlyAgentId, 'agent.container_start_spawned', {
                    issueId,
                    featureName,
                    workspacePath,
                  });
                  const containerChild = spawn('./dev', ['all'], {
                    cwd: workspacePath,
                    stdio: 'ignore',
                    env: buildChildEnvWithoutTmuxSync(process.env, { UID: String(containerUid), GID: String(containerGid), DOCKER_USER: `${containerUid}:${containerGid}` }),
                    detached: true,
                  });
                  containerChild.unref();

                  const maxWaitMs = 3 * 60 * 1000;
                  const pollIntervalMs = 3000;
                  const startTime = Date.now();
                  let healthy = false;

                  while (Date.now() - startTime < maxWaitMs) {
                    try {
                      const { stdout } = await execFileAsync(
                        'docker',
                        ['ps', '--filter', `name=${featureName}`, '--format', '{{.Names}}|{{.Status}}'],
                        { encoding: 'utf-8' }
                      );
                      const containers = stdout.trim().split('\n').filter(Boolean);
                      const allH = containers.length > 0 && containers.every(line => {
                        const status = line.split('|')[1] || '';
                        return status.includes('Up') && (!status.includes('(') || status.includes('(healthy)'));
                      });
                      if (allH) { healthy = true; break; }
                    } catch {}
                    await new Promise(r => setTimeout(r, pollIntervalMs));
                  }

                  await appendAgentLifecycleLog(earlyAgentId, healthy ? 'agent.container_wait_succeeded' : 'agent.container_wait_timed_out', {
                    issueId,
                    featureName,
                    waitedMs: Date.now() - startTime,
                  });

                  if (!healthy) {
                    saveAgentStateSync(buildContainerStartState({
                      agentSessionName: earlyAgentId,
                      issueId,
                      workspacePath,
                      role,
                      effectiveHarness,
                      startedBy,
                      allowHost,
                      status: 'error',
                      startedAt: new Date().toISOString(),
                    }));
                    return;
                  }

                  // Docker named volumes may create root-owned empty node_modules.
                  // Remove them — workspace creation runs bun install which creates
                  // correct workspace-aware node_modules with proper local package resolution.
                  for (const nmDir of [join(workspacePath, 'node_modules'), join(workspacePath, 'src', 'dashboard', 'frontend', 'node_modules')]) {
                    try {
                      if (existsSync(nmDir)) {
                        const stat = await lstat(nmDir);
                        if (!stat.isSymbolicLink()) {
                          await rm(nmDir, { recursive: true, force: true });
                          console.log(`[start-agent] Removed Docker-created ${nmDir}`);
                        }
                      }
                    } catch (nmErr: any) {
                      console.warn(`[start-agent] Could not remove ${nmDir}: ${nmErr.message}`);
                    }
                  }

                  await appendAgentLifecycleLog(earlyAgentId, 'agent.work_spawn_requested_after_containers', {
                    issueId,
                    role,
                    workspacePath,
                    harness: effectiveHarness,
                  });
                  emitStartAgentPhase(issueId, 'spawn', 'start', 'starting local work agent after containers became healthy', { workspacePath });
                  const activityId = await requestWorkStartAfterContainers({
                    args: buildPanStartArgs({
                      issueId,
                      model: spawnModel,
                      harness: effectiveHarness,
                      allowHost,
                    }),
                    workspacePath,
                    spawnPanCommand,
                    markWorkStartAccepted,
                    updateIssueStatus,
                  });
                  emitStartAgentPhase(issueId, 'spawn', 'success', 'local work agent spawn requested after container startup', {
                    workspacePath,
                    activityId,
                  });
                } catch (err: any) {
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  emitStartAgentPhase(issueId, 'spawn', 'failure', errorMessage, { workspacePath });
                  await appendAgentLifecycleLog(earlyAgentId, 'agent.container_start_failed', {
                    issueId,
                    error: errorMessage,
                  }).catch(() => undefined);
                  try {
                    saveAgentStateSync(buildContainerStartState({
                      agentSessionName: earlyAgentId,
                      issueId,
                      workspacePath,
                      role,
                      effectiveHarness,
                      startedBy,
                      allowHost,
                      status: 'error',
                      startedAt: new Date().toISOString(),
                    }));
                  } catch { /* non-fatal */ }
                  console.error(`[start-agent] Background container startup failed for ${issueId}:`, err);
                }
              })();

          yield* Effect.promise(() => Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId, status: 'In Progress', canonicalStatus: 'in_progress' },
          })));
          try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
          invalidateAgentsCache();
          return jsonResponse({
            success: true,
            message: `Starting containers and agent for ${issueId} (this may take a few minutes)`,
            startingContainers: true,
            containerActivityId,
            agentId: earlyAgentId,
            projectPath,
            guardrails: spawnGuardrails,
          });
        }
      }
    }

    return null;
  });
}
