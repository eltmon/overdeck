import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { FlywheelRunId } from '@overdeck/contracts';
import type { AgentState } from '../agents.js';
import type { FlywheelScope, RoleEffort } from '../config-yaml.js';
import { getAgentDir, spawnRun, stopAgent } from '../agents.js';
import { parseSequenceMd } from '../backlog/sequence-io.js';
import { pickFromSequence } from '../flywheel-merge-order.js';
import {
  getFlywheelActiveRunId,
  isFlywheelAutoPickupBacklog,
  isFlywheelRequireUatBeforeMerge,
  setFlywheelActiveRunId,
  setFlywheelGloballyPaused,
} from '../overdeck/control-settings.js';
import { resolveLiveFlywheelRunId, saveRunCohort } from '../../dashboard/server/services/flywheel-run-state.js';
import { buildClassifyLookups } from '../backlog/lookups.js';
import { computeCohort } from '../backlog/pickup.js';

export const FLYWHEEL_ORCHESTRATOR_AGENT_ID = 'flywheel-orchestrator';

const FlywheelRunIdSchema = Schema.String.check(Schema.isPattern(/^RUN-\d+$/));
const decodeFlywheelRunId = Schema.decodeUnknownSync(FlywheelRunIdSchema);

export interface FlywheelLifecycleOptions {
  runId?: FlywheelRunId;
  workspace?: string;
  briefPath?: string;
  prompt?: string;
  model?: string;
  harness?: 'claude-code' | 'ohmypi' | 'codex';
  effort?: RoleEffort;
  minAgents?: number;
  maxAgents?: number;
  scope?: FlywheelScope;
  autoPickupBacklog?: boolean;
  requireUatBeforeMerge?: boolean;
  env?: NodeJS.ProcessEnv;
  resumeSessionId?: string;
}

export interface FlywheelPauseResult {
  activeRunId: string | null;
}

export interface FlywheelResumeResult {
  activeRunId: string;
  agent: AgentState;
}

function parseRunId(runId: string): FlywheelRunId {
  return decodeFlywheelRunId(runId);
}

function defaultFlywheelRunId(): FlywheelRunId {
  return parseRunId(`RUN-${Date.now()}`);
}

function flywheelRunConfigurationSection(options: FlywheelLifecycleOptions): string {
  const configLines = [
    options.harness ? `Harness: ${options.harness}` : undefined,
    options.effort ? `Effort: ${options.effort}` : undefined,
    options.minAgents ? `Min concurrent agents (target): ${options.minAgents}` : undefined,
    options.maxAgents ? `Max concurrent agents (ceiling): ${options.maxAgents}` : undefined,
    options.scope ? `Scope: ${options.scope}` : undefined,
    typeof options.autoPickupBacklog === 'boolean'
      ? `Auto-pickup backlog: ${options.autoPickupBacklog}`
      : undefined,
    typeof options.requireUatBeforeMerge === 'boolean'
      ? `Require UAT before merge: ${options.requireUatBeforeMerge}`
      : undefined,
  ].filter(Boolean).join('\n');

  let sequenceSection = '';
  if (options.autoPickupBacklog) {
    const seqPath = join(process.cwd(), '.pan', 'backlog', 'sequence.md');
    if (existsSync(seqPath)) {
      try {
        const md = readFileSync(seqPath, 'utf-8');
        const parsed = parseSequenceMd(md);
        if (parsed.ok) {
          // Build issue lookups from the shared issue service (lazy-require avoids
          // circular module load during CLI startup).
          type IssueRow = { ref?: string; identifier?: string; labels?: string[]; author?: string; assignee?: { name?: string } | string };
          const getIssueRows = (): IssueRow[] => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as
                typeof import('../../dashboard/server/services/issue-service-singleton.js');
              return getSharedIssueService().getIssues() as IssueRow[];
            } catch { return []; }
          };
          const issueRowMap = new Map<string, IssueRow>(
            getIssueRows().map((i) => [i.ref ?? i.identifier ?? '', i]),
          );

          const issueLabelsLookup = (issueId: string): string[] =>
            issueRowMap.get(issueId)?.labels ?? [];

          const AUTHORIZED_AUTHORS = new Set(['eltmon', 'panopticon-agent[bot]']);
          const isAuthorizedIssue = (issueId: string): boolean => {
            const row = issueRowMap.get(issueId);
            if (!row) return false; // unknown issue — skip (safe default)
            if (row.author && AUTHORIZED_AUTHORS.has(row.author)) return true;
            const assigneeName = typeof row.assignee === 'string' ? row.assignee : row.assignee?.name;
            return assigneeName === 'eltmon';
          };

          const projectRoot = process.cwd();
          const specsDir = join(projectRoot, '.pan', 'specs');
          const workspacesDir = join(projectRoot, 'workspaces');
          const issuesWithSpecs = new Set<string>();
          if (existsSync(specsDir)) {
            for (const f of readdirSync(specsDir)) {
              const match = /^[\d-]+-([A-Z]+-\d+)-/i.exec(f);
              if (match) issuesWithSpecs.add(match[1]!.toUpperCase());
            }
          }
          const isReadyOrHasPrd = (issueId: string): boolean => {
            const id = issueId.toUpperCase();
            // ready = spec AND beads exist in the workspace
            if (issuesWithSpecs.has(id) &&
                existsSync(join(workspacesDir, `feature-${id.toLowerCase()}`, '.beads', 'issues.jsonl'))) {
              return true;
            }
            return existsSync(join(projectRoot, '.pan', 'drafts', `${id}.md`));
          };
          const isInPipeline = (issueId: string): boolean =>
            existsSync(join(workspacesDir, `feature-${issueId.toLowerCase()}`));

          const top10 = parsed.doc.nodes.slice(0, 10).map((n) =>
            `  #${n.rank} ${n.issue}: ${n.why.slice(0, 100)} [gate:${n.gate}]`,
          );
          const nextPick = pickFromSequence(parsed.doc.nodes, { issueLabels: issueLabelsLookup, isAuthorizedIssue, isReadyOrHasPrd, isInPipeline, requireReady: true, autoPickupBacklog: options.autoPickupBacklog });
          let nextLine: string;
          let pickInstruction: string;
          if (!nextPick) {
            nextLine = 'No eligible issue found in sequence — fall back to normal priority';
            pickInstruction = '';
          } else if (nextPick.planning === 'interactive') {
            // FR-17: interactive planning requires operator presence — must NOT be auto-started
            nextLine = `NEEDS OPERATOR ACTION: ${nextPick.issueId} (rank ${nextPick.rank}) has planning=interactive — do NOT auto-start; operator must run 'pan plan ${nextPick.issueId}'`;
            pickInstruction = `\n\nIMPORTANT: auto_pickup_backlog=true. The top-ranked issue requires interactive planning and MUST NOT be auto-started. Surface it to the operator for manual 'pan plan' invocation instead of auto-picking it.`;
          } else {
            nextLine = `MUST start next: ${nextPick.issueId} (rank ${nextPick.rank}, planning=${nextPick.planning})`;
            pickInstruction = `\n\nIMPORTANT: auto_pickup_backlog=true. You MUST pick the "MUST start next" issue above as your next startup target. Do NOT apply your own P0-P3/oldest-first ranking while a sequence is available.`;
          }
          sequenceSection = `\n\nBacklog sequence (${parsed.doc.nodes.length} issues ranked):\n${top10.join('\n')}\n${nextLine}${pickInstruction}`;
        }
      } catch {
        // sequence.md exists but couldn't be parsed — skip enrichment
      }
    }
  }

  return (configLines ? `\n\nRun configuration:\n${configLines}` : '') + sequenceSection;
}

function defaultFlywheelPrompt(runId: string, options: FlywheelLifecycleOptions, briefContent?: string): string {
  const configSection = flywheelRunConfigurationSection(options);
  const briefSection = options.briefPath
    ? `\n\nBrief path: ${options.briefPath}\n\n${briefContent ?? ''}`
    : '';
  return `FLYWHEEL ORCHESTRATOR TASK for ${runId}:

Run the Fix-All Flywheel loop. Keep status snapshots current, coordinate Overdeck roles through the normal pipeline surfaces, respect the configured run scope and agent cap, and wait for explicit lifecycle instructions when the run is paused or complete.${configSection}${briefSection}`;
}

function getLocalFlywheelRunDir(runId: string): string {
  const overdeckHome = process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
  return join(overdeckHome, 'flywheel', 'runs', runId);
}

export async function saveResumeSessionId(runId: string, sessionId: string): Promise<void> {
  const runDir = getLocalFlywheelRunDir(runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, 'resume-session.json'),
    JSON.stringify({ sessionId, pausedAt: new Date().toISOString() }),
    'utf-8',
  );
}

export async function loadResumeSessionId(runId: string): Promise<string | null> {
  try {
    const raw = await readFile(join(getLocalFlywheelRunDir(runId), 'resume-session.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
  } catch {
    return null;
  }
}

export function isFlywheelDevcontainerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const disabledDeacon = env.OVERDECK_DISABLE_DEACON?.toLowerCase();
  if (disabledDeacon === '1' || disabledDeacon === 'true') return true;

  const hostname = env.HOSTNAME?.toLowerCase() ?? '';
  return hostname.includes('devcontainer') || hostname.startsWith('api-feature-') || hostname.startsWith('workspace-');
}

/**
 * Resume prompt. PAN-2006 FR-8: re-attach the standing brief on resume so its
 * directives (pipeline-unblock override, never-block, red-main-first) survive a
 * resume + context compaction — the pre-PAN-2006 resume prompt only pointed at
 * FLYWHEEL-STATE.md and a long-running orchestrator could drift off-brief.
 */
export function buildFlywheelResumePrompt(configSection: string, briefContent?: string): string {
  const base =
    'FLYWHEEL RESUME: You were paused by the operator. Resume the tick loop from your prior ' +
    'state. Check `docs/FLYWHEEL-STATE.md` and the latest status snapshot for context.';
  const brief = briefContent
    ? `\n\n--- Standing brief (re-read it — it governs pickup, unblocking, and never-block) ---\n\n${briefContent}`
    : '';
  return `${base}${configSection}${brief}`;
}

export async function spawnFlywheelAgent(runId: string, options: FlywheelLifecycleOptions = {}): Promise<AgentState> {
  const workspace = options.workspace ?? process.cwd();
  // Re-read the brief on every spawn (fresh AND resume) so its directives survive
  // resume/compaction. Default to the standard brief path when none is supplied.
  const briefPath = options.briefPath ?? join(workspace, 'docs', 'flywheel-brief.md');
  const briefContent = await readFile(briefPath, 'utf8').catch(() => undefined);
  const prompt = options.resumeSessionId
    ? buildFlywheelResumePrompt(flywheelRunConfigurationSection(options), briefContent)
    : (options.prompt ?? defaultFlywheelPrompt(runId, options, briefContent));
  return spawnRun(runId, 'flywheel', {
    agentId: FLYWHEEL_ORCHESTRATOR_AGENT_ID,
    workspace,
    prompt,
    model: options.model,
    harness: options.harness,
    effort: options.effort,
    allowHost: true,
    registerConversation: true,
    resumeSessionId: options.resumeSessionId,
    flywheelRunId: runId,
  });
}

function withFlywheelAutonomyOptions(options: FlywheelLifecycleOptions): FlywheelLifecycleOptions {
  return {
    ...options,
    autoPickupBacklog: options.autoPickupBacklog ?? isFlywheelAutoPickupBacklog(),
    requireUatBeforeMerge: options.requireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge(),
  };
}

export async function spawnFlywheel(options: FlywheelLifecycleOptions = {}): Promise<AgentState> {
  if (isFlywheelDevcontainerRuntime(options.env)) {
    throw new Error('Refusing to spawn flywheel-orchestrator inside a workspace devcontainer');
  }

  // Self-healing gate check (PAN-1245): if the SQLite gate points at a run
  // that has already ended (report.md/aborted.json) or whose on-disk state is
  // gone (post-reboot, post-wipe), resolveLiveFlywheelRunId clears the gate
  // and returns null. Only a genuinely live prior run blocks a new start.
  const activeRunId = await resolveLiveFlywheelRunId();
  if (activeRunId) {
    throw new Error(`Flywheel run ${activeRunId} is already active; pause, resume, or report it before starting another run`);
  }

  const runId = options.runId ? parseRunId(options.runId) : defaultFlywheelRunId();
  const agent = await spawnFlywheelAgent(runId, withFlywheelAutonomyOptions(options));
  setFlywheelActiveRunId(runId);
  setFlywheelGloballyPaused(false);

  // PAN-2006 WI-7: freeze the run's cohort (in-flight ∪ current+next wave) at start.
  // The Run is complete once this cohort drains; mid-run pickups don't extend it.
  // Best-effort — a missing/unparseable sequence just means no cohort gate yet.
  try {
    const workspace = options.workspace ?? process.cwd();
    const seqPath = join(workspace, '.pan', 'backlog', 'sequence.md');
    if (existsSync(seqPath)) {
      const parsed = parseSequenceMd(readFileSync(seqPath, 'utf-8'));
      if (parsed.ok) {
        saveRunCohort(runId, computeCohort(parsed.doc.nodes, buildClassifyLookups(workspace), options.maxAgents ?? 5, options.autoPickupBacklog ?? isFlywheelAutoPickupBacklog()));
      }
    }
  } catch { /* cohort snapshot is best-effort */ }

  return agent;
}

export async function pauseFlywheel(): Promise<FlywheelPauseResult> {
  const activeRunId = getFlywheelActiveRunId();
  if (activeRunId) {
    try {
      const sessionId = (await readFile(join(getAgentDir(FLYWHEEL_ORCHESTRATOR_AGENT_ID), 'session.id'), 'utf-8')).trim();
      if (sessionId) await saveResumeSessionId(activeRunId, sessionId);
    } catch { /* non-fatal: resume falls back to fresh if session.id is missing */ }
  }
  setFlywheelGloballyPaused(true);
  await Effect.runPromise(stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID));
  return { activeRunId };
}

export async function resumeFlywheel(options: FlywheelLifecycleOptions = {}): Promise<FlywheelResumeResult> {
  if (isFlywheelDevcontainerRuntime(options.env)) {
    throw new Error('Refusing to resume flywheel-orchestrator inside a workspace devcontainer');
  }

  const activeRunId = getFlywheelActiveRunId();
  if (!activeRunId) {
    throw new Error('No active flywheel run to resume');
  }
  const runId = parseRunId(activeRunId);

  const resumeSessionId = options.resumeSessionId ?? await loadResumeSessionId(runId) ?? undefined;
  const agent = await spawnFlywheelAgent(runId, withFlywheelAutonomyOptions({ ...options, resumeSessionId }));
  setFlywheelGloballyPaused(false);
  return { activeRunId, agent };
}
