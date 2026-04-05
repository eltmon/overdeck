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
import { loadSettings, getAgentCommand, isAnthropicModel } from '../settings.js';
import { createWorkspace } from '../workspace-manager.js';

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
    await execAsync('tmux list-sessions 2>/dev/null', { encoding: 'utf-8' });
  } catch {
    // Tmux server not running, start it
    try {
      await execAsync('tmux new-session -d -s panopticon-init', { encoding: 'utf-8' });
      console.log('Started tmux server');
    } catch (startErr) {
      console.error('Failed to start tmux server:', startErr);
    }
  }
  // Strip env vars from tmux global environment that should NOT leak into
  // agent sessions. The tmux server inherits the dashboard's process.env
  // (which includes all of .panopticon.env), but agents should only receive
  // explicitly-passed provider-specific vars via createSession().
  const varsToStrip = [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
    'OPENAI_API_KEY', 'LINEAR_API_KEY', 'GITHUB_TOKEN',
    'ZAI_API_KEY', 'HUME_API_KEY', 'KIMI_API_KEY', 'GOOGLE_API_KEY',
  ];
  for (const envVar of varsToStrip) {
    try {
      await execAsync(`tmux set-environment -g -u ${envVar} 2>/dev/null`, { encoding: 'utf-8' });
    } catch {
      // Variable wasn't set — fine
    }
  }
}

// ─── Planning prompt builder ─────────────────────────────────────────────────

export function buildPlanningPrompt(issue: PlanningIssue, workspacePath: string, planningModel?: string): string {
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

  return `<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: ${issue.identifier}

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via \`bd create\`)
  - Implementation plan at \`docs/prds/active/{issue-id}-plan.md\` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** ${issue.identifier}
- **Title:** ${issue.title}
- **URL:** ${issue.url}

## Description
${issue.description || 'No description provided'}
${commentsSection}${specSection}${projectStructureSection}
---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| \`trivial\` | Typo, comment, formatting only | haiku |
| \`simple\` | Bug fix, single file, obvious change | haiku |
| \`medium\` | New feature, 3-5 files, standard patterns | sonnet |
| \`complex\` | Refactor, migration, 6+ files, some risk | sonnet |
| \`expert\` | Architecture, security, performance, high risk | opus |

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at \`docs/prds/active/{issue-id}-plan.md\` (required for dashboard)
3. Create a vBRIEF plan file at \`.planning/plan.vbrief.json\` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run \`bd create\` commands.** Beads tasks are created automatically from \`plan.vbrief.json\` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: \`vBRIEFInfo\` and \`plan\`.

\`\`\`json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/${version}",
    "description": "Plan for ${issue.identifier}: <issue title>"
  },
  "plan": {
    "id": "${issueLower}",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "${modelAuthor}",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "${issue.url}", "label": "${issue.identifier}", "type": "issue" }${prdFiles.length > 0 ? `,
      ${prdFiles.map(p => `{ "uri": "${p.path}", "label": "${p.label}", "type": "prd" }`).join(',\n      ')}` : ''}
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "${issueLower}"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
\`\`\`

**CRITICAL vBRIEF rules:**
- The file MUST have \`vBRIEFInfo\` and \`plan\` as the ONLY top-level keys
- \`plan.id\` MUST be the issue ID in lowercase (e.g., "${issueLower}")
- \`plan.uid\` MUST be a freshly generated UUID v4
- Do NOT use \`issue\`, \`issueId\`, or \`issue_id\` — use \`plan.id\`
- \`items[].status\` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be \`subItems\` with \`metadata.kind: "acceptance_criterion"\`
- \`metadata.difficulty\` and \`metadata.issueLabel\` are Panopticon extensions to the vBRIEF spec
- Edge types: \`blocks\` (hard dependency), \`informs\` (soft), \`invalidates\`, \`suggests\`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** \`*-spec.md\` files are human-written specs — do NOT overwrite them. Your output is \`*-plan.md\`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
`;
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
  const { issue, workspacePath, projectPath, sessionName, workspaceLocation, startDocker, shadowMode, onProgress } = opts;
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
              // Forward workspace sub-step progress as step 1 detail updates
              progress(1, event.label, event.detail, event.status === 'complete' ? 'active' : event.status);
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
    await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });

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

    // Determine planning model (before prompt so it's injected)
    const agentSettings = loadSettings();
    const planningModel = (agentSettings.models as any).planning_agent
      || agentSettings.models.complexity?.expert
      || 'claude-opus-4-6';

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
    const planningPrompt = buildPlanningPrompt(issue, workspacePath, planningModel);
    writeFileSync(planningPromptPath, planningPrompt);
    const agentCmd = getAgentCommand(planningModel);
    const cmdWithArgs = agentCmd.args.length > 0
      ? `${agentCmd.command} ${agentCmd.args.join(' ')} --dangerously-skip-permissions`
      : `${agentCmd.command} --dangerously-skip-permissions`;

    // ── Write launcher script ──────────────────────────────────────────────
    const initMessage = `Please read the planning prompt file at ${planningPromptPath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
    const promptFile = join(agentStateDir, 'init-prompt.txt');
    const launcherScript = join(agentStateDir, 'launcher.sh');
    writeFileSync(promptFile, initMessage);
    writeFileSync(launcherScript, `#!/bin/bash
# Set terminal environment for proper rendering (match remote launcher)
export TERM=xterm-256color
export COLORTERM=truecolor
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export PANOPTICON_AGENT_ID="${sessionName}"
export PANOPTICON_ISSUE_ID="${issue.identifier}"
export PANOPTICON_SESSION_TYPE="planning"
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
while true; do sleep 60; done
`, { mode: 0o755 });

    progress(4, 'Configuring agent', `${planningModel} — prompt & launcher ready`, 'complete');

    // ── Step 5: Launch planning session ───────────────────────────────────
    progress(5, 'Launching planning session', sessionName);

    await ensureTmuxRunning();
    await execAsync(
      `TERM=xterm-256color tmux new-session -d -s ${sessionName} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' },
    );
    // Protect the session from being destroyed when clients disconnect.
    // When the dashboard's WebSocket terminal attaches and then detaches,
    // tmux can destroy the session if destroy-unattached is on.
    await execAsync(`tmux set-option -t ${sessionName} destroy-unattached off 2>/dev/null || true`, { encoding: 'utf-8' });
    await execAsync(`tmux set-option -t ${sessionName} remain-on-exit on 2>/dev/null || true`, { encoding: 'utf-8' });

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
      runtime: isAnthropicModel(planningModel) ? 'claude' : 'claude-code-router',
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
