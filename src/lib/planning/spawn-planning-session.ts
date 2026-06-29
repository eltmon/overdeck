/**
 * Spawn Planning Session — background workspace + agent setup
 *
 * Extracted from the old Express /api/issues/:id/start-planning handler.
 * Creates workspace, writes planning prompt, spawns Claude Code in tmux.
 * Used by both the dashboard route and CLI.
 *
 * This runs as a background task after the API responds — the UI shows
 * "Waiting for session to start..." until the tmux session is ready.
 */

import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { extractTeamPrefix, findProjectByTeamSync, findProjectByPathSync } from '../projects.js';
import {
  sessionExists,
  createSession,
  killSession,
  setOption,
  exactPaneTarget,
  buildTmuxCommandString,
} from '../tmux.js';
import { createWorkspace } from '../workspace-manager.js';
import { renderPrompt } from '../cloister/prompts.js';
import { getAgentRuntimeBaseCommand, getProviderExportsForModel, retrieveSpawnTimeMemoryContext, roleAgentDefinitionPath, saveAgentStateSync, getAgentStateSync } from '../agents.js';
import { loadConfigSync, resolveModel } from '../config-yaml.js';
import { resolveHarness } from '../harness-resolve.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { ensureWorkspacePanDir, getWorkspacePanPaths, writeWorkspaceContext } from '../pan-dir/index.js';
import {
  appendSessionEntrySync,
  getIssueRecordPath,
  getProjectConfigFromWorkspacePath,
  resolveProjectForIssue,
} from '../pan-dir/record.js';
import { workspaceContextFile } from '../context-layers/layers.js';
import { ensureSessionContextBriefingFile } from '../briefing-freshness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Path to the per-issue "auto-spawn the work agent on planning finalize" flag,
 * written at planning spawn when the operator launched with --auto-start. This
 * is the single source of the launch-time auto-start intent; every finalize
 * path (CLI `pan plan finalize`, the dashboard Done button, host auto-finalize)
 * reads it so the intent is honored no matter how planning is completed.
 */
export function autoSpawnOnFinalizeFlagPath(issueId: string): string {
  const overdeckHome = process.env['OVERDECK_HOME'] ?? join(homedir(), '.overdeck');
  return join(overdeckHome, 'agents', `planning-${issueId.toLowerCase()}`, 'auto-spawn-on-finalize.json');
}

/** Read the persisted auto-spawn-on-finalize flag for an issue (false if unset/unreadable). */
export function readAutoSpawnOnFinalizeFlag(issueId: string): boolean {
  try {
    const flagFile = autoSpawnOnFinalizeFlagPath(issueId);
    if (!existsSync(flagFile)) return false;
    const flag = JSON.parse(readFileSync(flagFile, 'utf-8')) as { autoSpawnOnFinalize?: unknown };
    return flag.autoSpawnOnFinalize === true;
  } catch {
    return false;
  }
}

/**
 * Decide whether finalizing planning should auto-spawn the work agent. An
 * explicit request value always wins (`true`/`false`); otherwise fall back to
 * the persisted launch-time --auto-start flag. This keeps every finalize path —
 * the CLI `pan plan finalize`, the dashboard Done button, and host
 * auto-finalize — consistent with how the session was launched.
 */
export function resolveAutoSpawnOnFinalize(requestedAutoSpawn: unknown, issueId: string): boolean {
  if (requestedAutoSpawn === true) return true;
  if (requestedAutoSpawn === false) return false;
  return readAutoSpawnOnFinalizeFlag(issueId);
}

async function getPackageVersion(): Promise<string> {
  try {
    const pkgPath = resolve(__dirname, '../../../package.json');
    const pkgRaw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Discover PRD files matching an issue ID from docs/prds directories.
 * Returns list of { path, label } for use in references template.
 */
async function discoverPrdFiles(workspacePath: string, issueId: string): Promise<Array<{ path: string; label: string }>> {
  const issueLower = issueId.toLowerCase();
  const searchDirs = [
    join(workspacePath, 'docs', 'prds', 'planned'),
    join(workspacePath, 'docs', 'prds', 'active'),
    // Also check two levels up (worktrees)
    join(workspacePath, '..', '..', 'docs', 'prds', 'planned'),
    join(workspacePath, '..', '..', 'docs', 'prds', 'active'),
  ];

  const found: Array<{ path: string; label: string }> = [];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (file.toLowerCase().includes(issueLower)) {
          found.push({ path: join(dir, file), label: file });
        }
      }
    } catch { /* ignore read errors */ }
  }
  return found;
}

const execAsync = promisify(exec);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanningIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  source: 'linear' | 'github' | 'rally';
  comments?: Array<{ author: string; body: string; createdAt: string }>;
  /** Rally artifact type (e.g. "PortfolioItem/Feature") */
  artifactType?: string;
  /** Child stories for Rally Features */
  childStories?: Array<{ ref: string; title: string; status: string; description: string }>;
}

/** Progress event emitted during planning session setup. */
export interface PlanningProgress {
  step: number;
  total: number;
  label: string;
  detail: string;
  status: 'active' | 'complete' | 'error';
}

export interface SpawnPlanningOptions {
  issue: PlanningIssue;
  workspacePath: string;
  projectPath: string;
  sessionName: string;
  workspaceLocation: 'local' | 'remote';
  startDocker?: boolean;
  shadowMode?: boolean;
  /** Optional model override — if omitted, roles.plan.model is used. */
  model?: string;
  /** Optional harness override (PAN-636). */
  harness?: RuntimeName;
  /** Optional effort level — controls how thorough the planning agent is. */
  effort?: 'low' | 'medium' | 'high';
  /** Non-interactive planning: choose defensible defaults and record inferred choices. */
  auto?: boolean;
  /** Add the adversarial pre-finalize probe pass to the planning prompt. */
  probe?: boolean;
  /** Automatically start the work agent after finalize; stamped by trusted callers only. */
  autoSpawnOnFinalize?: boolean;
  /** Optional callback for streaming progress events to the client. */
  onProgress?: (event: PlanningProgress) => void;
}

export interface SpawnPlanningResult {
  success: boolean;
  error?: string;
}

export interface PlanningAgentStateInput {
  sessionName: string;
  issueId: string;
  workspacePath: string;
  model: string;
  harness: RuntimeName;
  workspaceLocation: 'local' | 'remote';
  autoSpawnOnFinalize?: boolean;
  startedAt?: string;
}

export function buildPlanningAgentState(input: PlanningAgentStateInput): Record<string, unknown> {
  return {
    id: input.sessionName,
    issueId: input.issueId,
    workspace: input.workspacePath,
    model: input.model,
    status: 'running',
    startedAt: input.startedAt ?? new Date().toISOString(),
    role: 'plan',
    harness: input.harness,
    location: input.workspaceLocation,
    autoSpawnOnFinalize: input.autoSpawnOnFinalize === true,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureTmuxRunning(): Promise<void> {
  try {
    const exists = await Effect.runPromise(sessionExists('overdeck-init'));
    if (!exists) {
      await Effect.runPromise(createSession('overdeck-init', homedir(), undefined));
      console.log('Started tmux server');
    }
  } catch (startErr) {
    console.error('Failed to start tmux server:', startErr);
  }
  // Strip env vars from tmux global environment that should NOT leak into
  // agent sessions. The tmux server inherits the dashboard's process.env
  // (which includes all of .overdeck.env), but agents should only receive
  // explicitly-passed provider-specific vars via createSession().
  const varsToStrip = [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
    'OPENAI_API_KEY', 'LINEAR_API_KEY', 'GITHUB_TOKEN',
    'HUME_API_KEY', 'KIMI_API_KEY', 'KIMI_CODING_API_KEY', 'GOOGLE_API_KEY',
    'MINIMAX_API_KEY', 'ZAI_API_KEY', 'MIMO_API_KEY',
    'OPENROUTER_API_KEY', 'NOUS_API_KEY', 'DASHSCOPE_API_KEY',
  ];
  for (const envVar of varsToStrip) {
    try {
      await execAsync(`${buildTmuxCommandString(['set-environment', '-g', '-u', envVar])} 2>/dev/null`, { encoding: 'utf-8' });
    } catch {
      // Variable wasn't set — fine
    }
  }
}

// ─── Planning prompt builder ─────────────────────────────────────────────────

export async function buildPlanningPrompt(issue: PlanningIssue, workspacePath: string, planningModel?: string, effort?: 'low' | 'medium' | 'high', auto = false, probe = false, memoryContext = ''): Promise<string> {
  const issueLower = issue.identifier.toLowerCase();
  const version = await getPackageVersion();
  const modelAuthor = planningModel ? `agent:${planningModel}` : 'agent:claude-opus-4-6';
  const prdFiles = await discoverPrdFiles(workspacePath, issue.identifier);

  // Build comments section
  let commentsSection = '';
  if (issue.comments && issue.comments.length > 0) {
    const commentLines = issue.comments
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(c => {
        const date = c.createdAt.slice(0, 10);
        const body = c.body.length > 2000 ? c.body.slice(0, 2000) + ' [truncated]' : c.body;
        return `### ${c.author} (${date}):\n${body}`;
      });
    commentsSection = `\n## Issue Comments\n\n**IMPORTANT: Read these comments carefully — they contain context, decisions, and references to previous work.**\n\n${commentLines.join('\n\n---\n\n')}\n`;
  }

  // Check for spec file
  let specSection = '';
  const specSearchDirs = [
    join(workspacePath, 'docs', 'prds', 'active'),
    join(workspacePath, '..', '..', 'docs', 'prds', 'active'),
  ];
  for (const specDir of specSearchDirs) {
    if (!existsSync(specDir)) continue;
    try {
      const files = await readdir(specDir);
      const specFile = files.find(f =>
        f.toLowerCase().includes(issueLower) && f.endsWith('-spec.md')
      );
      if (specFile) {
        const specContent = await readFile(join(specDir, specFile), 'utf-8');
        specSection = `
## Feature Spec (Human-Written)

**A spec has been written for this feature.** This is your primary input — read it carefully before starting discovery.

**File:** \`${join(specDir, specFile)}\`

<spec>
${specContent}
</spec>

`;
        break;
      }
    } catch { /* ignore read errors */ }
  }

  // Check for polyrepo structure
  const teamPrefix = extractTeamPrefix(issue.identifier);
  const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
  let projectStructureSection = '';
  if (projectConfig?.workspace?.type === 'polyrepo' && projectConfig.workspace.repos) {
    const repos = projectConfig.workspace.repos;
    projectStructureSection = `
## Project Structure (Polyrepo)

**IMPORTANT:** This project uses a **polyrepo** structure. The workspace root is NOT a git repository.
Each subdirectory is a separate git worktree:

| Directory | Purpose |
|-----------|---------|
${repos.map((r: any) => `| \`${r.name}/\` | Git worktree for ${r.path} |`).join('\n')}

**Git operations:**
- Run \`git status\`, \`git log\`, etc. INSIDE the subdirectories (e.g., \`cd fe && git status\`)
- The workspace root (\`${workspacePath}\`) has no \`.git\` directory
- Each subdirectory has its own branch: \`${repos[0]?.branch_prefix || 'feature/'}${issueLower}\`

`;
  }

  // Build child stories section for Rally Features
  let childStoriesSection = '';
  if (issue.childStories && issue.childStories.length > 0) {
    const storyLines = issue.childStories.map(
      (s) => `- **${s.ref}**: ${s.title} (status: ${s.status})\n  ${s.description || ''}`.trim(),
    );
    childStoriesSection = `\n## Child Stories\n\n**This Rally Feature has ${issue.childStories.length} child story(ies).** Reference these existing stories during planning — do NOT create new ones.\n\n${storyLines.join('\n\n')}\n\n**Cross-story dependencies:** If any child story must be completed before another, encode this as a \\\`blocks\\\` edge in the vBRIEF plan between the corresponding beads. Use \\\`informs\\\` for softer ordering hints.\n`;
  }

  const effortSection = effort && effort !== 'medium' ? `
## Planning Effort: ${effort === 'high' ? 'High (Deep Analysis)' : 'Low (Quick Planning)'}

${effort === 'high'
    ? `**The user has requested HIGH effort planning.** Be exceptionally thorough:
- Explore more of the codebase before concluding — check adjacent files, not just the obvious ones
- Identify edge cases, potential failure modes, and risks
- Consider multiple implementation approaches and explain tradeoffs
- Ask more clarifying questions when scope is ambiguous
- Break down tasks into finer-grained subtasks`
    : `**The user has requested LOW effort planning.** Be concise and fast:
- Focus on the most critical decisions only
- Keep the task list tight — 3–5 items max unless truly necessary
- Skip deep exploration; read only the directly relevant files
- Ask only essential clarifying questions`
  }

` : '';

  const prdReferences = prdFiles.length > 0
    ? `,\n      ${prdFiles.map(p => `{ "uri": "${p.path}", "label": "${p.label}", "type": "prd" }`).join(',\n      ')}`
    : '';

  const autoSection = auto ? `
## Auto Planning Mode

The user invoked \`pan plan --auto\`. Complete planning end-to-end without asking the user questions or waiting for interactive confirmation.

- Do not use AskUserQuestion.
- When normal planning would ask a question, choose the most defensible default and record it in \`plan.autoDecisions[]\` as \`{ "summary": "...", "rationale": "..." }\`.
- Halt only for a genuine contradiction between authoritative inputs, such as the issue body requiring one behavior while a linked PRD requires the opposite. If that happens, write the contradiction into continue.json hazards and stop with a clear escalation message so the dashboard surfaces it.
- Still produce the same complete vBRIEF and beads via \`pan plan finalize\` when no contradiction exists.
` : '';

  const probeSection = probe || effort === 'high' ? `
## Probe Pass (required before finalize)

After drafting the vBRIEF and BEFORE running \`pan plan finalize\`, attack your own plan:
- For each item: what hidden assumption would make this item wrong? Name it or clear it.
- Which item could produce two very different diffs that both look "done"? Tighten its
  ACs or set requiresInspection: true.
- What input, state, or failure mode does no item handle? Add an item or a NonGoals line.
- Which edge is missing (output→input you assumed implicitly)? Add it.

Record every probe finding you acted on in continue.json decisions[] (prefix "PROBE:").
If the probe pass changes nothing at all, record one decision: "PROBE: no findings".
` : '';

  return await Effect.runPromise(renderPrompt({
    name: 'planning',
    vars: {
      ISSUE_ID: issue.identifier,
      ISSUE_ID_LOWER: issueLower,
      ISSUE_TITLE: issue.title,
      ISSUE_URL: issue.url,
      ISSUE_DESCRIPTION: issue.description || 'No description provided',
      VERSION: version,
      MODEL_AUTHOR: modelAuthor,
      COMMENTS_SECTION: commentsSection,
      SPEC_SECTION: specSection,
      CHILD_STORIES_SECTION: childStoriesSection,
      PROJECT_STRUCTURE_SECTION: projectStructureSection,
      EFFORT_SECTION: effortSection,
      AUTO_SECTION: autoSection,
      PROBE_SECTION: probeSection,
      PRD_REFERENCES: prdReferences,
      MEMORY_CONTEXT: memoryContext,
      TLDR_AVAILABLE: existsSync(join(workspacePath, '.venv')),
    },
  }));
}

/**
 * Write workspace `.pan/context.md` for Rally Features so story work agents can
 * reference feature-level context (child stories, description, URL).
 */
async function claudePlanningSystemPromptFiles(workspacePath: string, harness: 'claude-code' | 'ohmypi' | 'codex'): Promise<string[]> {
  const files: string[] = [];
  const contextFile = workspaceContextFile(workspacePath);
  try {
    await access(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());

  const behavior = getHarnessBehavior(harness);
  // PAN-1566: Pi/ohmypi also receives the rendered global context layer.
  if (behavior.contextLayerKind === 'pi') {
    const { piGlobalContextFile } = await import('../context-layers/index.js');
    const globalFile = piGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }
  // PAN-1574: Codex receives its rendered global context layer (codex-global.md).
  // The per-agent CODEX_HOME/AGENTS.md is set up by initCodexHome at spawn time;
  // this file provides context for the planning session before spawn.
  if (behavior.contextLayerKind === 'codex') {
    const { codexGlobalContextFile } = await import('../context-layers/index.js');
    const globalFile = codexGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }

  return files;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export async function writeFeatureContext(workspacePath: string, issue: PlanningIssue): Promise<void> {
  if (!issue.artifactType?.includes('PortfolioItem')) return;
  const childStoriesSection = issue.childStories && issue.childStories.length > 0
    ? issue.childStories.map(s =>
        `### ${s.ref}: ${s.title}\n- **Status:** ${s.status}\n- **Description:** ${s.description || '(none)'}`
      ).join('\n\n')
    : '_No child stories found._';
  await Effect.runPromise(writeWorkspaceContext(
    workspacePath,
    `# Feature Context: ${issue.identifier}\n\n` +
      `**Title:** ${issue.title}\n\n` +
      `**URL:** ${issue.url}\n\n` +
      `## Description\n${issue.description || 'No description provided.'}\n\n` +
      `## Child Stories\n${childStoriesSection}\n\n` +
      `---\n` +
      `*This file is auto-generated for story-level workspaces to reference.*\n`,
  ));
}

export async function resolvePlanningSessionHarness(planningModel: string, explicit?: RuntimeName): Promise<RuntimeName> {
  return resolveHarness({ explicit, role: 'plan', model: planningModel });
}

// ─── Main spawn function ─────────────────────────────────────────────────────

/**
 * Spawn a planning agent session in the background.
 *
 * Creates workspace (if needed), writes planning prompt, and spawns Claude Code
 * in a tmux session. The agent state directory at ~/.overdeck/agents/<sessionName>/
 * must already exist with a preliminary state.json (status: 'starting').
 *
 * This function is designed to run as fire-and-forget after the API response
 * is sent. It updates agent state to 'running' on success or 'failed' on error.
 */
export async function spawnPlanningSession(opts: SpawnPlanningOptions): Promise<SpawnPlanningResult> {
  const { issue, workspacePath, projectPath, sessionName, workspaceLocation, startDocker, shadowMode, model: modelOverride, effort, auto, probe, autoSpawnOnFinalize, onProgress } = opts;
  const issueLower = issue.identifier.toLowerCase();
  const agentStateDir = join(homedir(), '.overdeck', 'agents', sessionName);

  const TOTAL_STEPS = 5;
  const progress = (step: number, label: string, detail: string, status: 'active' | 'complete' | 'error' = 'active') => {
    onProgress?.({ step, total: TOTAL_STEPS, label, detail, status });
  };

  try {
    console.log(`[start-planning] Background setup starting for ${issue.identifier}`);

    // ── Step 1: Create workspace if needed ─────────────────────────────────
    progress(1, 'Creating workspace', `${issueLower} on ${projectPath.split('/').pop() || 'project'}`);

    let workspaceCreated = false;
    if (existsSync(workspacePath)) {
      const files = await readdir(workspacePath);
      workspaceCreated = !files.every((f: string) => f === '.pan' || f === '.beads');
    }

    if (!workspaceCreated) {
      try {
        const projectConfig = findProjectByPathSync(projectPath) || findProjectByTeamSync(extractTeamPrefix(issue.identifier) || '');
        if (projectConfig?.workspace) {
          // Use library directly for real-time progress streaming
          console.log(`[start-planning] Creating workspace via library for ${issue.identifier}, projectConfig=${projectConfig.name}`);
          const wsResult = await Effect.runPromise(createWorkspace({
            projectConfig,
            featureName: issueLower,
            startDocker,
            onProgress: (event) => {
              console.log(`[start-planning] Workspace progress: ${event.label} — ${event.detail} [${event.status}]`);
              // Forward workspace sub-step progress as step 1 sub-step events
              progress(1, event.label, event.detail, event.status);
            },
          }));
          console.log(`[start-planning] Workspace result: success=${wsResult.success}, steps=${wsResult.steps.length}, errors=${wsResult.errors.length}`);
          if (wsResult.errors.length > 0) {
            console.error(`[start-planning] Workspace errors:`, wsResult.errors);
          }
          if (!wsResult.success) {
            throw new Error(wsResult.errors.join('; '));
          }
        } else {
          // Fallback: use CLI for projects without workspace config
          const dockerFlag = startDocker ? ' --docker' : '';
          const locationFlag = workspaceLocation === 'remote' ? ' --remote' : ' --local';
          const createCmd = `pan workspace create ${issue.identifier}${locationFlag}${dockerFlag}`;
          console.log(`[start-planning] Creating workspace via CLI: ${createCmd}`);
          await execAsync(createCmd, {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: startDocker ? 300000 : 120000,
          });
        }
        workspaceCreated = true;
        console.log(`[start-planning] Workspace created successfully`);
      } catch (err: any) {
        // CRITICAL: workspace MUST exist for local planning. If creation failed,
        // abort — never fall back to project root, which causes beads and planning
        // artifacts to land in the wrong place (PAN-358).
        const errorMsg = `Workspace creation failed: ${err.message}`;
        console.error(`[start-planning] ABORTING: ${errorMsg}`);
        progress(1, 'Creating workspace', errorMsg, 'error');
        const existingErrState = getAgentStateSync(sessionName);
        if (existingErrState) saveAgentStateSync({ ...existingErrState, status: 'error' });
        return { success: false, error: errorMsg };
      }
    }

    progress(1, 'Creating workspace', workspaceCreated ? 'Workspace ready' : 'Already exists', 'complete');

    // ── Step 2: Prepare planning environment ──────────────────────────────
    progress(2, 'Preparing planning environment', '.pan/ workspace artifacts');

    // Kill existing planning session if any
    await Effect.runPromise(killSession(sessionName)).catch(() => {});

    const workspacePanPaths = await Effect.runPromise(ensureWorkspacePanDir(workspacePath));
    await Promise.all(
      ['transcripts', 'discussions', 'notes'].map((subdir) =>
        mkdir(join(workspacePanPaths.panDir, subdir), { recursive: true }),
      ),
    );

    if (existsSync(workspacePanPaths.continuePath)) {
      console.log('[start-planning] Clearing stale .pan/continue.json');
      await rm(workspacePanPaths.continuePath, { force: true });
    }

    // Initialize Shadow Engineering if enabled
    if (shadowMode) {
      const inferencePath = join(workspacePanPaths.panDir, 'INFERENCE.md');
      if (!existsSync(inferencePath)) {
        await writeFile(inferencePath,
          `# Inference Document - ${issue.identifier.toUpperCase()}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n`,
          'utf-8',
        );
        console.log(`[start-planning] Shadow Engineering: Initialized INFERENCE.md`);
      }
    }

    progress(2, 'Preparing planning environment', 'Environment ready', 'complete');

    // ── Step 3: Load specs & PRDs ────────────────────────────────────────
    progress(3, 'Loading specs & PRDs', `Searching for ${issue.identifier} specs`);

    // Determine planning model — explicit override takes precedence over role routing.
    // PAN-1048 R1: resolveModel must NOT be wrapped in try/catch with a silent
    // fallback. If the user's roles.plan.model points at a missing workhorse
    // slot, an unknown model id, or a chained reference we can't dereference,
    // we want spawn to fail loudly with the precise error so the operator can
    // fix their config. The previous fallback to claude-opus-4-7 hid those
    // bugs and silently overrode their explicit configuration.
    let settingsModel: string;
    let modelSource: string;
    if (modelOverride) {
      settingsModel = modelOverride;
      modelSource = 'modelOverride';
    } else {
      settingsModel = resolveModel('plan', undefined, loadConfigSync().config, `plan:${issue.identifier}`);
      modelSource = 'roles.plan.model';
      console.log(`[start-planning] Model resolution for role=plan: model=${settingsModel} source=${modelSource}`);
    }
    const planningModel = modelOverride || settingsModel;
    const effectiveHarness = await resolvePlanningSessionHarness(planningModel, opts.harness);
    console.log(`[start-planning] Final planning model: ${planningModel} (override=${modelOverride || '(none)'} settings=${settingsModel} source=${modelSource}) harness=${effectiveHarness}`);

    // Discover and copy PRD files to workspace
    const prdFiles = await discoverPrdFiles(workspacePath, issue.identifier);
    if (prdFiles.length > 0) {
      const prdDestPath = join(workspacePanPaths.panDir, 'prd.md');
      if (!existsSync(prdDestPath)) {
        try {
          const prdContent = await readFile(prdFiles[0].path, 'utf-8');
          await writeFile(prdDestPath, prdContent, 'utf-8');
          console.log(`[start-planning] Copied PRD to ${prdDestPath} from ${prdFiles[0].path}`);
        } catch (err: any) {
          console.warn(`[start-planning] Could not copy PRD: ${err.message}`);
        }
      }
    }

    progress(3, 'Loading specs & PRDs', prdFiles.length > 0 ? prdFiles[0].label : 'No PRDs found', 'complete');

    // ── Step 4: Configure agent ─────────────────────────────────────────
    progress(4, 'Configuring agent', planningModel);

    let planningPrompt = await buildPlanningPrompt(issue, workspacePath, planningModel, effort, auto === true, probe === true);
    const memoryContext = await retrieveSpawnTimeMemoryContext({
      prompt: planningPrompt,
      issueId: issue.identifier,
      workspace: workspacePath,
      agentId: sessionName,
      role: 'plan',
      harness: effectiveHarness,
    });
    if (memoryContext) {
      planningPrompt = await buildPlanningPrompt(issue, workspacePath, planningModel, effort, auto === true, probe === true, memoryContext);
    }

    // Capture planning prompt in per-issue record (PAN-1919: replaces workspace continue.json).
    const recordProject = resolveProjectForIssue(issue.identifier) ?? getProjectConfigFromWorkspacePath(workspacePath);
    appendSessionEntrySync(recordProject, issue.identifier, {
      reason: 'planning',
      content: planningPrompt,
      note: `Planning session started for ${issue.identifier}: ${issue.title}`,
      timestamp: new Date().toISOString(),
    });

    await writeFeatureContext(workspacePath, issue);

    // PAN-1048: emit 'claude --agent roles/plan.md --name <sessionName>'.
    // PAN-636: thread harness through so a planning kickoff with --harness pi
    // produces a `pi --mode rpc --model <id>` line and skips the --agent flag
    // (Pi has no agent-definition system).
    const cmdWithArgs = await getAgentRuntimeBaseCommand(planningModel, sessionName, roleAgentDefinitionPath('plan'), effectiveHarness);

    const providerExports = await getProviderExportsForModel(planningModel);

    // ── Write launcher script ──────────────────────────────────────────────
    const recordFilePath = getIssueRecordPath(recordProject, issue.identifier);
    const initMessage = `Please read the \`content\` field of the \`planning\` sessionHistory entry in ${recordFilePath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
    const promptFile = join(agentStateDir, 'init-prompt.txt');
    const launcherScript = join(agentStateDir, 'launcher.sh');
    await writeFile(promptFile, initMessage);
    await writeFile(
      launcherScript,
      generateLauncherScriptSync({
        role: 'plan',
        workingDir: workspacePath,
        setTerminalEnv: true,
        overdeckEnv: { agentId: sessionName, issueId: issue.identifier, sessionType: 'plan' },
        providerExports,
        promptFile,
        baseCommand: cmdWithArgs,
        appendSystemPromptFiles: await claudePlanningSystemPromptFiles(workspacePath, effectiveHarness),
        trapHup: true,
        debugLog: '/tmp/pan-launcher-debug.log',
        keepAlive: true,
      }),
      { mode: 0o755 },
    );

    progress(4, 'Configuring agent', `${planningModel} — prompt & launcher ready`, 'complete');

    // ── Step 5: Launch planning session ───────────────────────────────────
    progress(5, 'Launching planning session', sessionName);

    console.log(`[claude-invoke] purpose=planning-agent | model=${planningModel} | source=spawn-planning-session.ts | session=${sessionName} | command="bash '${launcherScript}'"`);

    await ensureTmuxRunning();
    await Effect.runPromise(createSession(sessionName, workspacePath, `bash '${launcherScript}'`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        TERM: 'xterm-256color',
      },
    }));
    // Protect the session from being destroyed when clients disconnect.
    // When the dashboard's WebSocket terminal attaches and then detaches,
    // tmux can destroy the session if destroy-unattached is on.
    await Effect.runPromise(setOption(sessionName, 'destroy-unattached', 'off'));
    await Effect.runPromise(setOption(exactPaneTarget(sessionName), 'remain-on-exit', 'on'));

    // NOTE: No pre-resize of tmux window here. The WebSocket terminal handler
    // defers PTY spawn until the client sends its actual dimensions, so the
    // tmux window will be sized correctly from the start. Pre-resizing to
    // 200×50 caused a dimension cascade (200→120→actual) that garbled output.
    // See PAN-417 for the full forensic timeline.

    // ── Update agent state to running ──────────────────────────────────────
    // PAN-1048 R2: legacy `runtime` field removed; AgentState carries `harness`.
    {
      const baseState = getAgentStateSync(sessionName);
      saveAgentStateSync({
        ...(baseState ?? { id: sessionName, issueId: issue.identifier, workspace: workspacePath, startedAt: new Date().toISOString() }),
        model: planningModel,
        status: 'running',
        role: 'plan',
        harness: effectiveHarness,
      });
      if (autoSpawnOnFinalize) {
        await writeFile(
          join(agentStateDir, 'auto-spawn-on-finalize.json'),
          JSON.stringify({ autoSpawnOnFinalize: true }),
        );
      }
    }

    progress(5, 'Launching planning session', 'Agent running', 'complete');

    console.log(`[start-planning] Started local planning agent ${sessionName}`);
    return { success: true };

  } catch (err: any) {
    console.error(`[start-planning] Agent spawn failed for ${issue.identifier}:`, err);
    try {
      const existingCatchState = getAgentStateSync(sessionName);
      if (existingCatchState) saveAgentStateSync({ ...existingCatchState, status: 'error' });
    } catch { /* ignore state write errors */ }
    return { success: false, error: err.message };
  }
}
