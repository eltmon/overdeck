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

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { getAgentRuntimeBaseCommand, getProviderAuthMode, getProviderExportsForModel } from '../agents.js';
import { canUseHarness } from '../harness-policy.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { ensureWorkspacePanDir, getWorkspacePanPaths, writeWorkspaceContext, writeWorkspaceContinue } from '../pan-dir/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
  /** Optional model override — if omitted, the planning-agent setting is used. */
  model?: string;
  /** Optional harness override (PAN-636). Defaults to 'claude-code'. */
  harness?: 'claude-code' | 'pi';
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
    'HUME_API_KEY', 'KIMI_API_KEY', 'KIMI_CODING_API_KEY', 'GOOGLE_API_KEY',
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

export async function buildPlanningPrompt(issue: PlanningIssue, workspacePath: string, planningModel?: string, effort?: 'low' | 'medium' | 'high'): Promise<string> {
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
      CHILD_STORIES_SECTION: childStoriesSection,
      PROJECT_STRUCTURE_SECTION: projectStructureSection,
      EFFORT_SECTION: effortSection,
      PRD_REFERENCES: prdReferences,
    },
  });
}

/**
 * Write workspace `.pan/context.md` for Rally Features so story work agents can
 * reference feature-level context (child stories, description, URL).
 */
export async function writeFeatureContext(workspacePath: string, issue: PlanningIssue): Promise<void> {
  if (!issue.artifactType?.includes('PortfolioItem')) return;
  const childStoriesSection = issue.childStories && issue.childStories.length > 0
    ? issue.childStories.map(s =>
        `### ${s.ref}: ${s.title}\n- **Status:** ${s.status}\n- **Description:** ${s.description || '(none)'}`
      ).join('\n\n')
    : '_No child stories found._';
  writeWorkspaceContext(
    workspacePath,
    `# Feature Context: ${issue.identifier}\n\n` +
      `**Title:** ${issue.title}\n\n` +
      `**URL:** ${issue.url}\n\n` +
      `## Description\n${issue.description || 'No description provided.'}\n\n` +
      `## Child Stories\n${childStoriesSection}\n\n` +
      `---\n` +
      `*This file is auto-generated for story-level workspaces to reference.*\n`,
  );
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

    let workspaceCreated = false;
    if (existsSync(workspacePath)) {
      const files = await readdir(workspacePath);
      workspaceCreated = !files.every((f: string) => f === '.pan' || f === '.beads');
    }

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
        await writeFile(join(agentStateDir, 'state.json'), JSON.stringify({
          id: sessionName, issueId: issue.identifier, workspace: workspacePath,
          status: 'failed', error: errorMsg,
          startedAt: new Date().toISOString(), type: 'planning', agentPhase: 'planning', location: workspaceLocation,
        }, null, 2));
        return { success: false, error: errorMsg };
      }
    }

    progress(1, 'Creating workspace', workspaceCreated ? 'Workspace ready' : 'Already exists', 'complete');

    // ── Step 2: Prepare planning environment ──────────────────────────────
    progress(2, 'Preparing planning environment', '.pan/ workspace artifacts');

    // Kill existing planning session if any
    await killSessionAsync(sessionName).catch(() => {});

    const workspacePanPaths = ensureWorkspacePanDir(workspacePath);
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

    // Determine planning model — explicit override takes precedence over work-type router
    let settingsModel = 'claude-opus-4-6';
    let modelSource = 'fallback';
    try {
      const { getModel } = await import('../work-type-router.js');
      const resolution = getModel('planning-agent');
      settingsModel = resolution.model;
      modelSource = resolution.source;
      console.log(`[start-planning] Model resolution for planning-agent: model=${resolution.model} source=${resolution.source} usedFallback=${resolution.usedFallback} originalModel=${resolution.originalModel || '(none)'}`);
    } catch (err: any) {
      console.warn(`[start-planning] Work-type router failed for planning-agent, falling back to ${settingsModel}: ${err.message}`);
    }
    const planningModel = modelOverride || settingsModel;
    const requestedHarness = opts.harness ?? 'claude-code';
    const harnessDecision = canUseHarness(requestedHarness, planningModel, await getProviderAuthMode(planningModel));
    const effectiveHarness = harnessDecision.allowed ? requestedHarness : 'claude-code';
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

    const planningPrompt = await buildPlanningPrompt(issue, workspacePath, planningModel, effort);

    // Capture planning prompt in workspace .pan/continue.json.
    writeWorkspaceContinue(workspacePath, {
      version: '1',
      issueId: issue.identifier,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      beadsMapping: {},
      sessionHistory: [
        {
          reason: 'planning',
          content: planningPrompt,
          note: `Planning session started for ${issue.identifier}: ${issue.title}`,
          timestamp: new Date().toISOString(),
        },
      ],
      feedback: [],
    });

    await writeFeatureContext(workspacePath, issue);

    // PAN-982: emit 'claude --agent pan-planning-agent --name <sessionName>'.
    // PAN-636: thread harness through so a planning kickoff with --harness pi
    // produces a `pi --mode rpc --model <id>` line and skips the --agent flag
    // (Pi has no agent-definition system).
    const cmdWithArgs = await getAgentRuntimeBaseCommand(planningModel, sessionName, 'planning', effectiveHarness);

    const providerExports = await getProviderExportsForModel(planningModel);

    // ── Write launcher script ──────────────────────────────────────────────
    const continueFilePath = getWorkspacePanPaths(workspacePath).continuePath;
    const initMessage = `Please read the \`content\` field of the \`planning\` sessionHistory entry in ${continueFilePath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
    const promptFile = join(agentStateDir, 'init-prompt.txt');
    const launcherScript = join(agentStateDir, 'launcher.sh');
    await writeFile(promptFile, initMessage);
    await writeFile(
      launcherScript,
      generateLauncherScript({
        agentType: 'planning',
        workingDir: workspacePath,
        setCi: true,
        setTerminalEnv: true,
        panopticonEnv: { agentId: sessionName, issueId: issue.identifier, sessionType: 'planning' },
        providerExports,
        promptFile,
        baseCommand: cmdWithArgs,
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
    await createSessionAsync(sessionName, workspacePath, `bash '${launcherScript}'`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
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
    await writeFile(join(agentStateDir, 'state.json'), JSON.stringify({
      id: sessionName,
      issueId: issue.identifier,
      workspace: workspacePath,
      runtime: 'claude',
      model: planningModel,
      status: 'running',
      startedAt: new Date().toISOString(),
      type: 'planning',
      agentPhase: 'planning',
      location: workspaceLocation,
    }, null, 2));

    progress(5, 'Launching planning session', 'Agent running', 'complete');

    console.log(`[start-planning] Started local planning agent ${sessionName}`);
    return { success: true };

  } catch (err: any) {
    console.error(`[start-planning] Agent spawn failed for ${issue.identifier}:`, err);
    // Update state file to reflect failure
    try {
      await writeFile(join(agentStateDir, 'state.json'), JSON.stringify({
        id: sessionName,
        issueId: issue.identifier,
        workspace: workspacePath,
        status: 'failed',
        error: err.message,
        startedAt: new Date().toISOString(),
        type: 'planning',
        agentPhase: 'planning',
        location: workspaceLocation,
      }, null, 2));
    } catch { /* ignore state write errors */ }
    return { success: false, error: err.message };
  }
}
