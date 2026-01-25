import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawnAgent } from '../../../lib/agents.js';
import { resolveProjectFromIssue, hasProjects, listProjects } from '../../../lib/projects.js';

/**
 * Get Linear API key from environment or config file
 */
function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
}

/**
 * Check if an issue ID is a Linear issue (has team prefix like MIN-, PAN-, etc.)
 */
function isLinearIssue(issueId: string): boolean {
  return /^[A-Z]+-\d+$/i.test(issueId);
}

/**
 * Update Linear issue status to "In Progress" when agent starts
 */
async function updateLinearToInProgress(apiKey: string, issueIdentifier: string): Promise<boolean> {
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    // Search for the issue by identifier
    const results = await client.searchIssues(issueIdentifier, { first: 1 });
    const issue = results.nodes[0];

    if (!issue) return false;

    // Get the team to find workflow states
    const team = await issue.team;
    if (!team) return false;

    // Find the "In Progress" state
    const states = await team.states();
    const inProgressState = states.nodes.find((s) =>
      s.name === 'In Progress' || s.type === 'started'
    );

    if (!inProgressState) return false;

    // Update the issue state
    await issue.update({ stateId: inProgressState.id });

    return true;
  } catch (error) {
    // Silently fail - don't block agent spawn for Linear API issues
    return false;
  }
}

interface IssueOptions {
  model: string;
  runtime: string;
  dryRun?: boolean;
}

/**
 * Find the workspace directory for an issue.
 * First checks project registry for the correct project path,
 * then looks for workspaces/feature-{issue-id}/ in the project root.
 */
function findWorkspace(issueId: string, labels: string[] = []): string | null {
  const normalizedId = issueId.toLowerCase();

  // First, try to resolve from project registry
  const resolved = resolveProjectFromIssue(issueId, labels);
  if (resolved) {
    const workspaceName = `feature-${normalizedId}`;
    const workspacePath = join(resolved.projectPath, 'workspaces', workspaceName);
    if (existsSync(workspacePath)) {
      return workspacePath;
    }
    // Also try without "feature-" prefix
    const altPath = join(resolved.projectPath, 'workspaces', normalizedId);
    if (existsSync(altPath)) {
      return altPath;
    }
  }

  // Fall back to searching upward from cwd (backward compatible)
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const workspacesDir = join(dir, 'workspaces');
    if (existsSync(workspacesDir)) {
      // Look for feature-{issue-id} workspace
      const workspaceName = `feature-${normalizedId}`;
      const workspacePath = join(workspacesDir, workspaceName);
      if (existsSync(workspacePath)) {
        return workspacePath;
      }

      // Also try without "feature-" prefix
      const altPath = join(workspacesDir, normalizedId);
      if (existsSync(altPath)) {
        return altPath;
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Find the project root (contains workspaces/, .git, or CLAUDE.md)
 * First checks project registry, then falls back to searching upward.
 */
function findProjectRoot(issueId?: string, labels: string[] = []): string {
  // If we have an issue ID, try to resolve from registry first
  if (issueId) {
    const resolved = resolveProjectFromIssue(issueId, labels);
    if (resolved) {
      return resolved.projectPath;
    }
  }

  // Fall back to searching upward from cwd
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'workspaces')) ||
        existsSync(join(dir, '.git')) ||
        existsSync(join(dir, 'CLAUDE.md'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Read planning artifacts for an issue (STATE.md, etc.)
 */
function readPlanningContext(workspacePath: string): string | null {
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    return readFileSync(statePath, 'utf-8');
  }
  return null;
}

/**
 * Check if STATE.md contains Stitch design information
 * Returns the Stitch section if found, null otherwise
 */
function extractStitchDesigns(stateContent: string | null): string | null {
  if (!stateContent) return null;

  // Look for Stitch-related sections in STATE.md
  const stitchPatterns = [
    /## UI Designs[\s\S]*?(?=\n## |$)/i,
    /### Stitch Assets[\s\S]*?(?=\n### |\n## |$)/i,
    /## Stitch[\s\S]*?(?=\n## |$)/i,
  ];

  for (const pattern of stitchPatterns) {
    const match = stateContent.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  // Also check for Stitch project/screen IDs mentioned anywhere
  if (stateContent.includes('Stitch') &&
      (stateContent.includes('Project ID') || stateContent.includes('Screen ID'))) {
    // Extract the relevant paragraph
    const lines = stateContent.split('\n');
    const stitchLines: string[] = [];
    let inStitchSection = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('stitch')) {
        inStitchSection = true;
      }
      if (inStitchSection) {
        stitchLines.push(line);
        if (line.trim() === '' && stitchLines.length > 3) {
          break;
        }
      }
    }

    if (stitchLines.length > 0) {
      return stitchLines.join('\n').trim();
    }
  }

  return null;
}

/**
 * Extract beads IDs from STATE.md content
 * Looks for patterns like `panopticon-1dg` in backticks or tables
 */
function extractBeadsIdsFromState(stateContent: string): string[] {
  const ids: string[] = [];

  // Match beads IDs in backticks (e.g., `panopticon-1dg`)
  const backtickMatches = stateContent.match(/`([a-z]+-[a-z0-9]+)`/g) || [];
  for (const match of backtickMatches) {
    const id = match.replace(/`/g, '');
    // Filter for valid beads IDs (project-xxx format)
    if (id.match(/^[a-z]+-[a-z0-9]{2,4}$/)) {
      ids.push(id);
    }
  }

  return [...new Set(ids)]; // Deduplicate
}

/**
 * Read beads tasks for an issue from both workspace and project root.
 * Uses STATE.md to find the associated beads IDs.
 */
function readBeadsTasks(workspacePath: string, projectRoot: string, issueId: string): string[] {
  const tasks: string[] = [];
  const normalizedId = issueId.toLowerCase();

  // First, extract beads IDs from STATE.md
  const stateContent = readPlanningContext(workspacePath);
  const beadsIds = stateContent ? extractBeadsIdsFromState(stateContent) : [];

  // Check both locations for beads database
  const beadsPaths = [
    join(workspacePath, '.beads', 'issues.jsonl'),
    join(projectRoot, '.beads', 'issues.jsonl'),
  ];

  const seenIds = new Set<string>();

  for (const beadsPath of beadsPaths) {
    if (!existsSync(beadsPath)) continue;

    try {
      const content = readFileSync(beadsPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const task = JSON.parse(line);
          if (seenIds.has(task.id)) continue;

          // Match by:
          // 1. Task ID is in the STATE.md beads list
          // 2. Task is tagged with the issue ID
          // 3. Task title contains the issue ID
          const tags = task.tags || [];
          const isMatch =
            beadsIds.includes(task.id) ||
            tags.some((t: string) => t.toLowerCase().includes(normalizedId)) ||
            task.title?.toLowerCase().includes(normalizedId);

          if (isMatch) {
            seenIds.add(task.id);
            tasks.push(`- [${task.status || 'open'}] ${task.title} (${task.id})`);
          }
        } catch {}
      }
    } catch {}
  }

  return tasks;
}

/**
 * Build a comprehensive prompt with planning context
 */
function buildAgentPrompt(issueId: string, workspacePath: string, projectRoot: string): string {
  const lines: string[] = [
    `# Working on Issue: ${issueId}`,
    '',
    `**Workspace:** ${workspacePath}`,
    '',
  ];

  // Check what context files exist
  const hasStateFile = existsSync(join(workspacePath, '.planning', 'STATE.md'));
  const hasClaudeMd = existsSync(join(workspacePath, 'CLAUDE.md'));
  const hasProjectClaudeMd = existsSync(join(projectRoot, 'CLAUDE.md'));

  // CRITICAL: Instruct agent to read context files FIRST
  lines.push('## IMPORTANT: Read Context Files First');
  lines.push('');
  lines.push('Before starting any work, you MUST read these files to understand the full context:');
  lines.push('');

  if (hasStateFile) {
    lines.push(`1. **Read \`.planning/STATE.md\`** - Contains the full planning context, decisions made, and current status for this issue.`);
  }
  if (hasClaudeMd) {
    lines.push(`2. **Read \`CLAUDE.md\`** (in workspace) - Contains workspace-specific instructions and warnings.`);
  }
  if (hasProjectClaudeMd && projectRoot !== workspacePath) {
    lines.push(`3. **Read \`${projectRoot}/CLAUDE.md\`** - Contains project-wide development guidelines.`);
  }

  lines.push('');
  lines.push('These files contain critical context that may have been updated since the last session.');
  lines.push('');

  // Add beads tasks summary
  const beadsTasks = readBeadsTasks(workspacePath, projectRoot, issueId);
  if (beadsTasks.length > 0) {
    lines.push('## Beads Tasks');
    lines.push('');
    lines.push('Tasks created during planning (check STATE.md for which are complete):');
    lines.push('');
    lines.push(beadsTasks.join('\n'));
    lines.push('');
    lines.push('Use `bd show <task-id>` to see task details, `bd update <task-id> --status in_progress` to start work.');
    lines.push('');
  }

  // Add Stitch design information if present in STATE.md
  const planningContent = readPlanningContext(workspacePath);
  const stitchDesigns = extractStitchDesigns(planningContent);
  if (stitchDesigns) {
    lines.push('## UI Designs (Stitch)');
    lines.push('');
    lines.push('The planning agent created UI designs using Google Stitch. Use these assets:');
    lines.push('');
    lines.push(stitchDesigns);
    lines.push('');
    lines.push('**To convert Stitch designs to React:**');
    lines.push('- Use `/stitch-react-components` skill with the Project/Screen IDs above');
    lines.push('- Or check if DESIGN.md already exists for styling guidelines');
    lines.push('');
  }

  lines.push('## Your Task');
  lines.push('');
  lines.push('1. Read the context files listed above');
  lines.push('2. Check STATE.md for current status and what work remains');
  lines.push('3. Continue implementing the planned work');
  lines.push('4. Mark beads tasks as complete as you finish them: `bd update <task-id> --status closed`');
  lines.push('');

  // CRITICAL: Instructions for maintaining state for crash recovery
  lines.push('## CRITICAL: Keep STATE.md Updated');
  lines.push('');
  lines.push('**You may be interrupted, crash, or be stopped at any time.** To ensure the next agent can continue:');
  lines.push('');
  lines.push('1. **Update `.planning/STATE.md` frequently** as you complete work');
  lines.push('2. After completing each task or significant milestone, update the "Current Status" section');
  lines.push('3. Document any decisions made or blockers encountered');
  lines.push('4. Keep the "Remaining Work" section accurate');
  lines.push('');
  lines.push('The next agent will read STATE.md to know exactly where to pick up. Beads tasks track individual items,');
  lines.push('but STATE.md provides the narrative context and current state that beads alone cannot capture.');
  lines.push('');

  // CRITICAL: No lazy agents - complete ALL work
  lines.push('## CRITICAL: Complete ALL Work - No Excuses');
  lines.push('');
  lines.push('**You are an autonomous agent. You MUST complete the entire issue without stopping to ask for permission or options.**');
  lines.push('');
  lines.push('❌ **NEVER do any of these:**');
  lines.push('- Stop and ask "What would you like me to do?"');
  lines.push('- Offer options like "Option 1, Option 2, Option 3"');
  lines.push('- Say work requires "manual intervention" or "human review"');
  lines.push('- Give time estimates ("this would take 5-10 hours")');
  lines.push('- Suggest "targeted approach" or "stop here"');
  lines.push('- Defer work to "future PRs" or "follow-up issues"');
  lines.push('- Say "remaining work documented for later"');
  lines.push('- Declare infrastructure "complete" when tests still fail');
  lines.push('');
  lines.push('✅ **ALWAYS do this instead:**');
  lines.push('- Complete ALL phases of the plan from start to finish');
  lines.push('- Fix ALL failing tests, not just "high-impact" ones');
  lines.push('- If something is broken, fix it - don\'t document it');
  lines.push('- If tests fail, debug and fix them until they pass');
  lines.push('- Work autonomously until the issue is FULLY resolved');
  lines.push('- The only acceptable end state is: all tests pass, all code committed, pushed');
  lines.push('');
  lines.push('**You have unlimited time and context. Use it. Do not be lazy.**');
  lines.push('');

  // CRITICAL: Work completion requirements
  lines.push('## CRITICAL: Work Completion Requirements');
  lines.push('');
  lines.push('**You are NOT done until ALL of these are true:**');
  lines.push('');
  lines.push('1. **Tests pass** - Run the full test suite (`npm test` or equivalent)');
  lines.push('2. **All changes committed** - `git status` shows "nothing to commit, working tree clean"');
  lines.push('3. **Pushed to remote** - `git push -u origin $(git branch --show-current)`');
  lines.push('');
  lines.push('**Before declaring work complete, run:**');
  lines.push('```bash');
  lines.push('npm test                                         # Run tests');
  lines.push('git add -A && git commit -m "feat: description"  # Commit ALL changes');
  lines.push('git push -u origin $(git branch --show-current)  # Push');
  lines.push('git status                                       # Must show "nothing to commit"');
  lines.push(`pan work done ${issueId} -c "Brief summary"      # Signal completion`);
  lines.push('```');
  lines.push('');
  lines.push('**IMPORTANT:** Run `pan work done` when finished - this updates the issue to "In Review" so the user knows to review your work.');
  lines.push('');
  lines.push('**Uncommitted changes = NOT COMPLETE. Do not say you are done if `git status` shows changes.**');
  lines.push('');

  return lines.join('\n');
}

export async function issueCommand(id: string, options: IssueOptions): Promise<void> {
  const spinner = ora(`Preparing workspace for ${id}...`).start();

  try {
    // Normalize issue ID (MIN-648 -> min-648 for tmux session name)
    const normalizedId = id.toLowerCase();

    // Find workspace for this issue (using project registry first, then cwd fallback)
    const projectRoot = findProjectRoot(id);
    let workspace = findWorkspace(id);

    // Log project resolution info
    const resolved = resolveProjectFromIssue(id);
    if (resolved) {
      spinner.text = `Resolved project: ${resolved.projectName} (${resolved.projectPath})`;
    }

    if (!workspace) {
      spinner.warn(`No workspace found for ${id}, using project root`);
      workspace = projectRoot;
    } else {
      spinner.text = `Found workspace: ${workspace}`;
    }

    if (options.dryRun) {
      spinner.info('Dry run mode');
      console.log('');
      console.log(chalk.bold('Would create:'));
      console.log(`  Agent ID:   agent-${normalizedId}`);
      console.log(`  Workspace:  ${workspace}`);
      console.log(`  Runtime:    ${options.runtime}`);
      console.log(`  Model:      ${options.model}`);

      // Show what context would be included
      const planningContext = readPlanningContext(workspace);
      const beadsTasks = readBeadsTasks(workspace, projectRoot, id);
      console.log('');
      console.log(chalk.bold('Context:'));
      console.log(`  Planning:   ${planningContext ? 'Found (.planning/STATE.md)' : 'None'}`);
      console.log(`  Beads:      ${beadsTasks.length} tasks`);
      return;
    }

    spinner.text = 'Building agent prompt with planning context...';
    const prompt = buildAgentPrompt(id, workspace, projectRoot);

    spinner.text = 'Spawning agent...';

    const agent = await spawnAgent({
      issueId: id,
      workspace,
      runtime: options.runtime,
      model: options.model,
      prompt,
    });

    spinner.succeed(`Agent spawned: ${agent.id}`);

    // Update Linear issue to "In Progress" if applicable
    if (isLinearIssue(id)) {
      const apiKey = getLinearApiKey();
      if (apiKey) {
        const updated = await updateLinearToInProgress(apiKey, id);
        if (updated) {
          console.log(chalk.green(`  ✓ Updated ${id.toUpperCase()} to In Progress`));
        }
      }
    }

    console.log('');
    console.log(chalk.bold('Agent Details:'));
    console.log(`  Session:    ${chalk.cyan(agent.id)}`);
    console.log(`  Workspace:  ${workspace}`);
    console.log(`  Runtime:    ${agent.runtime} (${agent.model})`);

    // Show context info
    const planningContext = readPlanningContext(workspace);
    const beadsTasks = readBeadsTasks(workspace, projectRoot, id);
    if (planningContext || beadsTasks.length > 0) {
      console.log('');
      console.log(chalk.bold('Context Loaded:'));
      if (planningContext) console.log(`  Planning:   ${chalk.green('✓')} STATE.md`);
      if (beadsTasks.length > 0) console.log(`  Beads:      ${chalk.green('✓')} ${beadsTasks.length} tasks`);
    }

    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  Attach:   tmux attach -t ${agent.id}`);
    console.log(`  Message:  pan work tell ${id} "your message"`);
    console.log(`  Kill:     pan work kill ${id}`);

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
