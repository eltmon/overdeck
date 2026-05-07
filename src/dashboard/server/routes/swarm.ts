/**
 * Swarm route module — Effect HttpRouter.Layer (PAN-970)
 *
 * Implements:
 *   POST /api/swarm          — dispatch wave-parallel agents for a vBRIEF plan
 *   GET  /api/swarm/:issueId — get swarm state for an issue
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { ReadModelService } from '../read-model.js';
import { getSystemHealthSnapshot, getResourceConfig, type SystemHealthSnapshot } from '../services/system-health-service.js';
import { evaluateSpawnGuardrails } from './agents.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { findPlan, readWorkspacePlan } from '../../../lib/vbrief/io.js';
import { groupItemsByWave, type Wave, type WaveItem } from '../../../lib/vbrief/dag.js';
import type { VBriefDocument, VBriefItem } from '../../../lib/vbrief/types.js';
import { spawnAgent, type SpawnOptions } from '../../../lib/agents.js';
import { listSessionNamesAsync, isPaneDeadAsync, killSessionAsync } from '../../../lib/tmux.js';

const execAsync = promisify(exec);

// ─── Swarm state persistence ────────────────────────────────────────────────

interface SlotAssignment {
  slot: number;
  itemId: string;
  itemTitle: string;
  sessionName: string;
  workspace: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
}

interface SwarmState {
  issueId: string;
  currentWave: number;
  totalWaves: number;
  model: string;
  slots: SlotAssignment[];
  createdAt: string;
  updatedAt: string;
}

function getSwarmDir(): string {
  return join(homedir(), '.panopticon', 'swarms');
}

function getSwarmStatePath(issueId: string): string {
  return join(getSwarmDir(), `${issueId.toLowerCase()}.json`);
}

async function loadSwarmState(issueId: string): Promise<SwarmState | null> {
  const path = getSwarmStatePath(issueId);
  if (!existsSync(path)) return null;
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveSwarmState(state: SwarmState): Promise<void> {
  const dir = getSwarmDir();
  await mkdir(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(getSwarmStatePath(state.issueId), JSON.stringify(state, null, 2));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

const DEFAULT_SWARM_MODEL = 'kimi-k2.6';

async function createSlotWorktree(
  projectPath: string,
  issueId: string,
  slotNum: number,
): Promise<{ success: boolean; workspacePath: string; branch: string; parentBranch: string; error?: string }> {
  const issueLower = issueId.toLowerCase();
  const featureBranch = `feature/${issueLower}`;
  const slotBranch = `feature/${issueLower}/slot-${slotNum}`;
  const slotWorkspaceName = `feature-${issueLower}-slot-${slotNum}`;
  const workspacePath = join(projectPath, 'workspaces', slotWorkspaceName);

  if (existsSync(workspacePath)) {
    return { success: true, workspacePath, branch: slotBranch, parentBranch: featureBranch };
  }

  try {
    await execAsync('git fetch origin', { cwd: projectPath });
    await execAsync('git worktree prune', { cwd: projectPath });

    // Create slot worktree branching off the main feature branch
    const { stdout: localBranches } = await execAsync('git branch --list', { cwd: projectPath });
    const { stdout: remoteBranches } = await execAsync('git branch -r --list', { cwd: projectPath });
    const localList = localBranches.split('\n').map(b => b.replace(/^[*+\s]+/, '').trim()).filter(Boolean);
    const remoteList = remoteBranches.split('\n').map(b => b.trim()).filter(Boolean);

    const slotBranchExists =
      localList.includes(slotBranch) ||
      remoteList.includes(`origin/${slotBranch}`);

    if (slotBranchExists) {
      await execAsync(`git worktree add "${workspacePath}" "${slotBranch}"`, { cwd: projectPath });
    } else {
      // Branch off the main feature branch (or main if feature branch doesn't exist)
      const baseBranch = localList.includes(featureBranch) || remoteList.includes(`origin/${featureBranch}`)
        ? featureBranch
        : 'main';
      await execAsync(`git worktree add "${workspacePath}" -b "${slotBranch}" "${baseBranch}"`, { cwd: projectPath });
    }

    // Restore any unstaged deletions
    await execAsync('git restore .', { cwd: workspacePath }).catch(() => {});
    await execAsync('git config beads.role contributor', { cwd: workspacePath }).catch(() => {});

    // Set up beads redirect
    const sourceBeadsDir = join(projectPath, '.beads');
    if (existsSync(sourceBeadsDir)) {
      const worktreeBeadsDir = join(workspacePath, '.beads');
      const redirectPath = join(worktreeBeadsDir, 'redirect');
      if (!existsSync(redirectPath)) {
        try {
          await mkdir(worktreeBeadsDir, { recursive: true });
          const relPath = relative(workspacePath, sourceBeadsDir);
          await writeFile(redirectPath, relPath, 'utf-8');
        } catch {}
      }
    }

    // Install dependencies (non-fatal)
    try {
      await execAsync('bun install', { cwd: workspacePath, timeout: 60000 });
    } catch {}

    return { success: true, workspacePath, branch: slotBranch, parentBranch: featureBranch };
  } catch (err: any) {
    return { success: false, workspacePath, branch: slotBranch, parentBranch: featureBranch, error: err.message };
  }
}

// ─── POST /api/swarm ────────────────────────────────────────────────────────

const postSwarmRoute = HttpRouter.add(
  'POST',
  '/api/swarm',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const readModel = yield* ReadModelService;

    const { issueId, wave: requestedWave, model: requestedModel, maxSlots } = body as {
      issueId?: string;
      wave?: number;
      model?: string;
      maxSlots?: number;
    };

    if (!issueId) {
      return jsonResponse({ error: 'issueId required' }, { status: 400 });
    }

    const issueLower = issueId.toLowerCase();
    const issueUpper = issueId.toUpperCase();

    // Resolve project
    const project = resolveProjectFromIssue(issueId);
    if (!project) {
      return jsonResponse({ error: `Could not resolve project for ${issueUpper}` }, { status: 404 });
    }

    // Find the main workspace to read the vBRIEF
    const mainWorkspace = join(project.projectPath, 'workspaces', `feature-${issueLower}`);
    if (!existsSync(mainWorkspace)) {
      return jsonResponse({
        error: `No workspace found for ${issueUpper}`,
        hint: 'Create a workspace first: pan start ' + issueUpper,
      }, { status: 404 });
    }

    // Read vBRIEF and compute waves
    const doc = readWorkspacePlan(mainWorkspace);
    if (!doc) {
      return jsonResponse({
        error: `No vBRIEF plan found for ${issueUpper}`,
        hint: 'Run planning first to produce a vBRIEF plan.',
      }, { status: 422 });
    }

    const waves = groupItemsByWave(doc);
    if (waves.length === 0) {
      return jsonResponse({
        error: `No actionable items in the plan for ${issueUpper}`,
        hint: 'All items may already be completed or cancelled.',
      }, { status: 422 });
    }

    // Determine which wave to dispatch
    const waveIndex = requestedWave ?? 0;
    const targetWave = waves.find(w => w.index === waveIndex);
    if (!targetWave) {
      return jsonResponse({
        error: `Wave ${waveIndex} not found. Available: ${waves.map(w => w.index).join(', ')}`,
      }, { status: 422 });
    }

    // Check spawn guardrails
    const health: SystemHealthSnapshot = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    const guardrails = evaluateSpawnGuardrails(health);
    if (guardrails.blocked) {
      return jsonResponse({
        error: guardrails.error,
        hint: guardrails.hint,
        guardrails,
      }, { status: guardrails.status });
    }

    const swarmModel = requestedModel || DEFAULT_SWARM_MODEL;

    // Compute how many slots the system can actually handle right now
    const resourceConfig = getResourceConfig();
    const hardLimit = Number(process.env['PAN_AGENT_BLOCK_COUNT']) || resourceConfig.agentBlockCount;
    const currentAgents = health.summary.workAgentCount;
    const systemAvailable = Math.max(0, hardLimit - currentAgents);

    if (systemAvailable === 0) {
      return jsonResponse({
        error: `No agent capacity available (${currentAgents}/${hardLimit} agents running).`,
        hint: 'Wait for running agents to finish or stop some before dispatching a swarm.',
      }, { status: 429 });
    }

    const userMax = maxSlots ?? 4;
    const maxConcurrent = Math.min(targetWave.items.length, userMax, systemAvailable);
    const itemsToDispatch = targetWave.items.slice(0, maxConcurrent);
    const deferredItems = targetWave.items.slice(maxConcurrent);

    // Idempotency: check for existing swarm sessions
    const existingSessions = yield* Effect.promise(() => listSessionNamesAsync());
    const existingSwarmSessions = existingSessions.filter(
      s => s.startsWith(`agent-${issueLower}-`) && /agent-[a-z0-9-]+-\d+$/.test(s),
    );

    // Kill dead panes, skip alive ones
    const aliveSlots = new Set<string>();
    for (const sessionName of existingSwarmSessions) {
      const isDead = yield* Effect.promise(() => isPaneDeadAsync(sessionName));
      if (isDead) {
        yield* Effect.promise(() => killSessionAsync(sessionName).catch(() => {}));
      } else {
        aliveSlots.add(sessionName);
      }
    }

    // Spawn slots
    const dispatched: SlotAssignment[] = [];
    const errors: string[] = [];

    for (let i = 0; i < itemsToDispatch.length; i++) {
      const item = itemsToDispatch[i]!;
      const slotNum = i + 1;
      const sessionName = `agent-${issueLower}-${slotNum}`;

      if (aliveSlots.has(sessionName)) {
        dispatched.push({
          slot: slotNum,
          itemId: item.id,
          itemTitle: item.title,
          sessionName,
          workspace: '',
          status: 'running',
        });
        continue;
      }

      // Create slot worktree
      const worktreeResult = yield* Effect.promise(() =>
        createSlotWorktree(project.projectPath, issueId, slotNum),
      );

      if (!worktreeResult.success) {
        errors.push(`Slot ${slotNum}: failed to create worktree — ${worktreeResult.error}`);
        continue;
      }

      // Copy the vBRIEF plan into the slot workspace
      const planPath = findPlan(mainWorkspace);
      if (planPath) {
        yield* Effect.promise(async () => {
          const slotPanDir = join(worktreeResult.workspacePath, '.pan');
          await mkdir(slotPanDir, { recursive: true });
          const slotPlanPath = join(slotPanDir, 'spec.vbrief.json');
          if (!existsSync(slotPlanPath)) {
            try {
              const planContent = await readFile(planPath, 'utf-8');
              await writeFile(slotPlanPath, planContent);
            } catch {}
          }
        });
      }

      // Build the slot-specific prompt
      const itemPrompt = buildSlotPrompt(
        doc,
        issueUpper,
        item,
        waveIndex,
        slotNum,
        worktreeResult.branch,
        worktreeResult.parentBranch,
      );

      try {
        const spawnOptions: SpawnOptions = {
          issueId,
          workspace: worktreeResult.workspacePath,
          model: swarmModel,
          slotId: slotNum,
          swarmItemId: item.id,
          prompt: itemPrompt,
          phase: 'implementation',
        };

        yield* Effect.promise(() => spawnAgent(spawnOptions));

        dispatched.push({
          slot: slotNum,
          itemId: item.id,
          itemTitle: item.title,
          sessionName,
          workspace: worktreeResult.workspacePath,
          status: 'running',
          startedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        errors.push(`Slot ${slotNum} (${item.id}): ${err.message}`);
      }
    }

    // Save swarm state
    const state: SwarmState = {
      issueId: issueUpper,
      currentWave: waveIndex,
      totalWaves: waves.length,
      model: swarmModel,
      slots: dispatched,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    yield* Effect.promise(() => saveSwarmState(state));

    return jsonResponse({
      success: true,
      issueId: issueUpper,
      wave: waveIndex,
      totalWaves: waves.length,
      model: swarmModel,
      dispatched: dispatched.length,
      capacity: { current: currentAgents, limit: hardLimit, available: systemAvailable },
      slots: dispatched.map(s => ({
        slot: s.slot,
        itemId: s.itemId,
        itemTitle: s.itemTitle,
        sessionName: s.sessionName,
        status: s.status,
      })),
      deferred: deferredItems.length > 0
        ? deferredItems.map(item => ({ itemId: item.id, itemTitle: item.title }))
        : undefined,
      errors: errors.length > 0 ? errors : undefined,
      wavePlan: waves,
    });
  })),
);

interface StructuredSlotTaskInput {
  schema: 'AgentTaskInput';
  agent_id: string;
  issue_id: string;
  plan_id: string;
  task_id: string;
  title: string;
  wave_index: number;
  slot: number;
  branch: string;
  pr_target: string;
  workspace_plan_path: string;
  dependencies: Array<{ item_id: string; title: string }>;
  acceptance_criteria: string[];
}

function extractAcceptanceCriteria(item: VBriefItem): string[] {
  return (item.subItems ?? [])
    .filter(subItem => subItem.metadata?.kind === 'acceptance_criterion')
    .map(subItem => subItem.title);
}

function buildStructuredSlotTaskInput(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  slotBranch: string,
  parentBranch: string,
): StructuredSlotTaskInput {
  const fullItem = doc.plan.items.find(planItem => planItem.id === item.id);
  const itemById = new Map(doc.plan.items.map(planItem => [planItem.id, planItem]));
  const issueLower = issueId.toLowerCase();

  return {
    schema: 'AgentTaskInput',
    agent_id: `agent-${issueLower}-${slotNum}`,
    issue_id: issueId,
    plan_id: doc.plan.id,
    task_id: item.id,
    title: item.title,
    wave_index: waveIndex,
    slot: slotNum,
    branch: slotBranch,
    pr_target: parentBranch,
    workspace_plan_path: '.pan/spec.vbrief.json',
    dependencies: item.blockedBy.map((dependencyId) => ({
      item_id: dependencyId,
      title: itemById.get(dependencyId)?.title ?? dependencyId,
    })),
    acceptance_criteria: fullItem ? extractAcceptanceCriteria(fullItem) : [],
  };
}

function buildSlotPrompt(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  slotBranch: string,
  parentBranch: string,
): string {
  const taskInput = buildStructuredSlotTaskInput(
    doc,
    issueId,
    item,
    waveIndex,
    slotNum,
    slotBranch,
    parentBranch,
  );

  return [
    `You are swarm slot ${slotNum} working on wave ${waveIndex} of plan ${doc.plan.id}.`,
    `Your assigned task is: **${item.id}: ${item.title}**`,
    '',
    'Focus ONLY on this specific task from the vBRIEF plan.',
    'The plan is in .pan/spec.vbrief.json — read it for full context, acceptance criteria, and dependencies.',
    '',
    'Structured AgentTaskInput:',
    '```json',
    JSON.stringify(taskInput, null, 2),
    '```',
    '',
    `Your slot branch: **${slotBranch}**`,
    `Parent feature branch (merge target): **${parentBranch}**`,
    '',
    'When your task is complete:',
    `1. Commit your changes to branch \`${slotBranch}\``,
    `2. Find your bead: \`bd list -l ${doc.plan.id.toLowerCase()} --status open\` and look for the one matching "${item.title}"`,
    `3. Close it: \`bd close <bead-id>\``,
    `4. Push branch \`${slotBranch}\``,
    `5. Create a PR targeting \`${parentBranch}\` — do NOT target main`,
    '',
    `Do NOT run \`pan done\` — that closes the entire issue. You are one slot in a parallel swarm.`,
    'Other slots are working on sibling tasks in parallel. Stay within your task scope.',
  ].join('\n');
}

// ─── GET /api/swarm/:issueId ────────────────────────────────────────────────

const getSwarmRoute = HttpRouter.add(
  'GET',
  '/api/swarm/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const state = yield* Effect.promise(() => loadSwarmState(issueId));
    if (!state) {
      return jsonResponse({ error: `No swarm state for ${issueId}` }, { status: 404 });
    }

    // Enrich with live session status
    const sessions = yield* Effect.promise(() => listSessionNamesAsync());
    for (const slot of state.slots) {
      const alive = sessions.includes(slot.sessionName);
      if (!alive && slot.status === 'running') {
        slot.status = 'completed';
      }
    }

    return jsonResponse(state);
  })),
);

// ─── Export ─────────────────────────────────────────────────────────────────

export const swarmRouteLayer = Layer.mergeAll(
  postSwarmRoute,
  getSwarmRoute,
);
