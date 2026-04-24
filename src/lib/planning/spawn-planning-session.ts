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

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { extractTeamPrefix, findProjectByTeam, findProjectByPath } from '../projects.js';
import {
  sessionExistsAsync,
  createSessionAsync,
  killSessionAsync,
  setOptionAsync,
  buildTmuxCommandString,
} from '../tmux.js';
import { createWorkspace } from '../workspace-manager.js';
import { renderPrompt } from '../cloister/prompts.js';
import { getAgentRuntimeBaseCommand, getProviderExportsForModel } from '../agents.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function getPackageVersion(): string {
  try {
    const pkgPath = resolve(__dirname, '../../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Discover PRD files matching an issue ID from docs/prds directories.
 * Returns list of { path, label } for use in references template.
 */
function discoverPrdFiles(workspacePath: string, issueId: string): Array<{ path: string; label: string }> {
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
      const files = readdirSync(dir);
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
  /** Optional model override — if omitted, the planning-agent setting is used. */
  model?: string;
  /** Optional effort level — controls how thorough the planning agent is. */
  effort?: 'low' | 'medium' | 'high';
  /** Optional callback for streaming progress events to the client. */
  onProgress?: (event: PlanningProgress) => void;
}

export interface SpawnPlanningResult {
  success: boolean;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureTmuxRunning(): Promise<void> {
  try {
    const exists = await sessionExistsAsync('panopticon-init');
    if (!exists) {
      await createSessionAsync('panopticon-init', homedir(), undefined);
      console.log('Started tmux server');
    }
  } catch (startErr) {
    console.error('Failed to start tmux server:', startErr);
  }
  // Strip env vars from tmux global environment that should NOT leak into
  // agent sessions. The tmux server inherits the dashboard's process.env
  // (which includes all of .panopticon.env), but agents should only receive
  // explicitly-passed provider-specific vars via createSession().
  const varsToStrip = [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
    'OPENAI_API_KEY', 'LINEAR_API_KEY', 'GITHUB_TOKEN',
    'HUME_API_KEY', 'KIMI_API_KEY', 'GOOGLE_API_KEY',
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

export function buildPlanningPrompt(issue: PlanningIssue, workspacePath: string, planningModel?: string, effort?: 'low' | 'medium' | 'high'): string {
  const issueLower = issue.identifier.toLowerCase();
  const version = getPackageVersion();
  const modelAuthor = planningModel ? `agent:${planningModel}` : 'agent:claude-opus-4-6';
  const prdFiles = discoverPrdFiles(workspacePath, issue.identifier);

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
      const files = readdirSync(specDir);
      const specFile = files.find(f =>
        f.toLowerCase().includes(issueLower) && f.endsWith('-spec.md')
      );
      if (specFile) {
        const specContent = readFileSync(join(specDir, specFile), 'utf-8');
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
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
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

  return renderPrompt({
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
      PROJECT_STRUCTURE_SECTION: projectStructureSection,
      EFFORT_SECTION: effortSection,
      PRD_REFERENCES: prdReferences,
    },
  });
}

// ─── Main spawn function ─────────────────────────────────────────────────────

/**
 * Spawn a planning agent session in the background.
 *
 * Creates workspace (if needed), writes planning prompt, and spawns Claude Code
 * in a tmux session. The agent state directory at ~/.panopticon/agents/<sessionName>/
 * must already exist with a preliminary state.json (status: 'starting').
 *
 * This function is designed to run as fire-and-forget after the API response
 * is sent. It updates agent state to 'running' on success or 'failed' on error.
 */
export async function spawnPlanningSession(opts: SpawnPlanningOptions): Promise<SpawnPlanningResult> {
  const { issue, workspacePath, projectPath, sessionName, workspaceLocation, startDocker, shadowMode, model: modelOverride, effort, onProgress } = opts;
  const issueLower = issue.identifier.toLowerCase();
  const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);

  const TOTAL_STEPS = 5;
  const progress = (step: number, label: string, detail: string, status: 'active' | 'complete' | 'error' = 'active') => {
    onProgress?.({ step, total: TOTAL_STEPS, label, detail, status });
  };

  try {
    console.log(`[start-planning] Background setup starting for ${issue.identifier}`);

    // ── Step 1: Create workspace if needed ─────────────────────────────────
    progress(1, 'Creating workspace', `${issueLower} on ${projectPath.split('/').pop() || 'project'}`);

    let workspaceCreated = existsSync(workspacePath) &&
      !readdirSync(workspacePath).every((f: string) => f === '.planning');

    if (!workspaceCreated) {
      try {
        const projectConfig = findProjectByPath(projectPath) || findProjectByTeam(extractTeamPrefix(issue.identifier) || '');
        if (projectConfig?.workspace) {
          // Use library directly for real-time progress streaming
          console.log(`[start-planning] Creating workspace via library for ${issue.identifier}, projectConfig=${projectConfig.name}`);
          const wsResult = await createWorkspace({
            projectConfig,
            featureName: issueLower,
            startDocker,
            onProgress: (event) => {
              console.log(`[start-planning] Workspace progress: ${event.label} — ${event.detail} [${event.status}]`);
              // Forward workspace sub-step progress as step 1 sub-step events
              progress(1, event.label, event.detail, event.status);
            },
          });
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
        writeFileSync(join(agentStateDir, 'state.json'), JSON.stringify({
          id: sessionName, issueId: issue.identifier, workspace: workspacePath,
          status: 'failed', error: errorMsg,
          startedAt: new Date().toISOString(), type: 'planning', location: workspaceLocation,
        }, null, 2));
        return { success: false, error: errorMsg };
      }
    }

    progress(1, 'Creating workspace', workspaceCreated ? 'Workspace ready' : 'Already exists', 'complete');

    // ── Step 2: Prepare planning environment ──────────────────────────────
    progress(2, 'Preparing planning environment', '.planning/ directory structure');

    // Kill existing planning session if any
    await killSessionAsync(sessionName).catch(() => {});

    // Create planning directory structure
    const planningDir = join(workspacePath, '.planning');
    mkdirSync(planningDir, { recursive: true });
    for (const subdir of ['transcripts', 'discussions', 'notes']) {
      mkdirSync(join(planningDir, subdir), { recursive: true });
    }

    // Clear stale STATE.md and .planning-complete from previous session
    for (const staleFile of ['STATE.md', '.planning-complete']) {
      const stalePath = join(planningDir, staleFile);
      if (existsSync(stalePath)) {
        console.log(`[start-planning] Clearing stale ${staleFile}`);
        rmSync(stalePath, { force: true });
      }
    }

    // Initialize Shadow Engineering if enabled
    if (shadowMode) {
      const inferencePath = join(planningDir, 'INFERENCE.md');
      if (!existsSync(inferencePath)) {
        writeFileSync(inferencePath,
          `# Inference Document - ${issue.identifier.toUpperCase()}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n`,
          'utf-8',
        );
        console.log(`[start-planning] Shadow Engineering: Initialized INFERENCE.md`);
      }
    }

    progress(2, 'Preparing planning environment', 'Environment ready', 'complete');

    // ── Step 3: Load specs & PRDs ────────────────────────────────────────
    progress(3, 'Loading specs & PRDs', `Searching for ${issue.identifier} specs`);

    // Determine planning model — explicit override takes precedence over work-type router
    let settingsModel = 'claude-opus-4-6';
    try {
      const { getModelId } = await import('../work-type-router.js');
      settingsModel = getModelId('planning-agent');
    } catch { /* fall back to default */ }
    const planningModel = modelOverride || settingsModel;

    // Discover and copy PRD files to workspace
    const prdFiles = discoverPrdFiles(workspacePath, issue.identifier);
    if (prdFiles.length > 0) {
      const prdDestPath = join(planningDir, 'prd.md');
      if (!existsSync(prdDestPath)) {
        // Copy the first matching PRD (prefer active over planned)
        try {
          const prdContent = readFileSync(prdFiles[0].path, 'utf-8');
          writeFileSync(prdDestPath, prdContent, 'utf-8');
          console.log(`[start-planning] Copied PRD to ${prdDestPath} from ${prdFiles[0].path}`);
        } catch (err: any) {
          console.warn(`[start-planning] Could not copy PRD: ${err.message}`);
        }
      }
    }

    progress(3, 'Loading specs & PRDs', prdFiles.length > 0 ? prdFiles[0].label : 'No PRDs found', 'complete');

    // ── Step 4: Configure agent ─────────────────────────────────────────
    progress(4, 'Configuring agent', planningModel);

    const planningPromptPath = join(planningDir, 'PLANNING_PROMPT.md');
    const planningPrompt = buildPlanningPrompt(issue, workspacePath, planningModel, effort);
    writeFileSync(planningPromptPath, planningPrompt);
    const cmdWithArgs = getAgentRuntimeBaseCommand(planningModel);

    const providerExports = getProviderExportsForModel(planningModel);

    // ── Write launcher script ──────────────────────────────────────────────
    const initMessage = `Please read the planning prompt file at ${planningPromptPath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
    const promptFile = join(agentStateDir, 'init-prompt.txt');
    const launcherScript = join(agentStateDir, 'launcher.sh');
    writeFileSync(promptFile, initMessage);
    writeFileSync(launcherScript, `#!/bin/bash
# Set terminal environment for proper rendering (match remote launcher)
export CI=1
export TERM=xterm-256color
export COLORTERM=truecolor
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export PANOPTICON_AGENT_ID="${sessionName}"
export PANOPTICON_ISSUE_ID="${issue.identifier}"
export PANOPTICON_SESSION_TYPE="planning"
${providerExports}
cd "${workspacePath}"
prompt=$(cat "${promptFile}")
trap '' HUP
echo "[launcher] Claude starting at $(date)" >> /tmp/pan-launcher-debug.log
${cmdWithArgs} "$prompt"
CLAUDE_EXIT=$?
echo "[launcher] Claude exited with code $CLAUDE_EXIT at $(date)" >> /tmp/pan-launcher-debug.log
# Keep session alive after Claude exits so user can review and click Done
echo ""
echo "Planning agent has exited. Session kept alive for review."
echo "Click 'Done' in the dashboard when ready to hand off to implementation."
echo "[launcher] Keep-alive loop starting at $(date)" >> /tmp/pan-launcher-debug.log
trap '' HUP
while true; do sleep 60; done
`, { mode: 0o755 });

    progress(4, 'Configuring agent', `${planningModel} — prompt & launcher ready`, 'complete');

    // ── Step 5: Launch planning session ───────────────────────────────────
    progress(5, 'Launching planning session', sessionName);

    await ensureTmuxRunning();
    await createSessionAsync(sessionName, workspacePath, `bash '${launcherScript}'`, {
      env: {
        TERM: 'xterm-256color',
      },
    });
    // Protect the session from being destroyed when clients disconnect.
    // When the dashboard's WebSocket terminal attaches and then detaches,
    // tmux can destroy the session if destroy-unattached is on.
    await setOptionAsync(sessionName, 'destroy-unattached', 'off');
    await setOptionAsync(sessionName, 'remain-on-exit', 'on');

    // NOTE: No pre-resize of tmux window here. The WebSocket terminal handler
    // defers PTY spawn until the client sends its actual dimensions, so the
    // tmux window will be sized correctly from the start. Pre-resizing to
    // 200×50 caused a dimension cascade (200→120→actual) that garbled output.
    // See PAN-417 for the full forensic timeline.

    // ── Update agent state to running ──────────────────────────────────────
    writeFileSync(join(agentStateDir, 'state.json'), JSON.stringify({
      id: sessionName,
      issueId: issue.identifier,
      workspace: workspacePath,
      runtime: 'claude',
      model: planningModel,
      status: 'running',
      startedAt: new Date().toISOString(),
      type: 'planning',
      location: workspaceLocation,
    }, null, 2));

    progress(5, 'Launching planning session', 'Agent running', 'complete');

    console.log(`[start-planning] Started local planning agent ${sessionName}`);
    return { success: true };

  } catch (err: any) {
    console.error(`[start-planning] Agent spawn failed for ${issue.identifier}:`, err);
    // Update state file to reflect failure
    try {
      writeFileSync(join(agentStateDir, 'state.json'), JSON.stringify({
        id: sessionName,
        issueId: issue.identifier,
        workspace: workspacePath,
        status: 'failed',
        error: err.message,
        startedAt: new Date().toISOString(),
        type: 'planning',
        location: workspaceLocation,
      }, null, 2));
    } catch { /* ignore state write errors */ }
    return { success: false, error: err.message };
  }
}
