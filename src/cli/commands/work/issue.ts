import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { spawnAgent } from '../../../lib/agents.js';

interface IssueOptions {
  model: string;
  runtime: string;
  dryRun?: boolean;
}

/**
 * Find the workspace directory for an issue.
 * Looks for workspaces/feature-{issue-id}/ in the project root.
 */
function findWorkspace(issueId: string): string | null {
  const normalizedId = issueId.toLowerCase();

  // Search upward for a project root (has .git or workspaces/)
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
 */
function findProjectRoot(): string {
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
  lines.push('```');
  lines.push('npm test                                         # Run tests');
  lines.push('git add -A && git commit -m "feat: description"  # Commit ALL changes');
  lines.push('git push -u origin $(git branch --show-current)  # Push');
  lines.push('git status                                       # Must show "nothing to commit"');
  lines.push('```');
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

    // Find workspace for this issue
    const projectRoot = findProjectRoot();
    let workspace = findWorkspace(id);

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

    const agent = spawnAgent({
      issueId: id,
      workspace,
      runtime: options.runtime,
      model: options.model,
      prompt,
    });

    spinner.succeed(`Agent spawned: ${agent.id}`);

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
