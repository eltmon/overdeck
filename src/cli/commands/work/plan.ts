import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PlanOptions {
  output?: string;
  json?: boolean;
  skipDiscovery?: boolean;
  force?: boolean;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { name: string };
  priority: number;
  url: string;
  labels?: { name: string }[];
  assignee?: { name: string };
  project?: { name: string };
}

interface ComplexityAnalysis {
  isComplex: boolean;
  reasons: string[];
  subsystems: string[];
  estimatedTasks: number;
}

interface PlanTask {
  name: string;
  description: string;
  dependsOn?: string;
}

interface DiscoveryDecision {
  question: string;
  answer: string;
}

function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
}

async function findPRDFiles(issueId: string): Promise<string[]> {
  const found: string[] = [];
  const cwd = process.cwd();

  const searchPaths = [
    'docs/prds/active',
    'docs/prds/planned',
    'docs/prds',
    'docs/prd',
    'prds',
    'docs',
  ];

  const issueIdLower = issueId.toLowerCase();

  for (const searchPath of searchPaths) {
    const fullPath = join(cwd, searchPath);
    if (!existsSync(fullPath)) continue;

    try {
      const { stdout: result } = await execAsync(
        `find "${fullPath}" -type f -name "*.md" 2>/dev/null | xargs grep -l -i "${issueIdLower}" 2>/dev/null || true`,
        { encoding: 'utf-8' }
      );

      const files = result.trim().split('\n').filter(f => f);
      found.push(...files);
    } catch {
      // Ignore search errors
    }
  }

  return [...new Set(found)];
}

/**
 * Analyze issue complexity to determine if full planning is needed
 */
function analyzeComplexity(issue: LinearIssue, prdFiles: string[]): ComplexityAnalysis {
  const reasons: string[] = [];
  const subsystems: string[] = [];
  let estimatedTasks = 1;

  const desc = (issue.description || '').toLowerCase();
  const title = issue.title.toLowerCase();
  const combined = `${title} ${desc}`;

  // Check for multiple subsystems
  if (combined.includes('frontend') || combined.includes('ui') || combined.includes('component')) {
    subsystems.push('frontend');
  }
  if (combined.includes('backend') || combined.includes('api') || combined.includes('endpoint')) {
    subsystems.push('backend');
  }
  if (combined.includes('database') || combined.includes('migration') || combined.includes('schema')) {
    subsystems.push('database');
  }
  if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) {
    subsystems.push('tests');
  }

  if (subsystems.length > 1) {
    reasons.push(`Multiple subsystems involved: ${subsystems.join(', ')}`);
    estimatedTasks += subsystems.length;
  }

  // Check for ambiguous requirements
  const ambiguousPatterns = [
    'should we', 'maybe', 'or', 'consider', 'option', 'approach',
    'tbd', 'to be determined', 'needs discussion', 'unclear'
  ];
  for (const pattern of ambiguousPatterns) {
    if (combined.includes(pattern)) {
      reasons.push('Requirements may be ambiguous');
      break;
    }
  }

  // Check for architecture keywords
  const architecturePatterns = [
    'refactor', 'architecture', 'redesign', 'restructure', 'migrate',
    'integration', 'authentication', 'authorization', 'security'
  ];
  for (const pattern of architecturePatterns) {
    if (combined.includes(pattern)) {
      reasons.push(`Architecture decision needed: ${pattern}`);
      estimatedTasks += 2;
      break;
    }
  }

  // Check description length (longer = more complex usually)
  if (desc.length > 500) {
    reasons.push('Detailed description suggests complexity');
    estimatedTasks += 1;
  }

  // Check for existing PRD (pre-done discovery)
  if (prdFiles.length > 0) {
    reasons.push(`PRD exists - complexity already documented`);
  }

  // Check labels for complexity hints
  const complexLabels = ['complex', 'large', 'epic', 'multi-phase', 'architecture'];
  for (const label of issue.labels || []) {
    if (complexLabels.some(cl => label.name.toLowerCase().includes(cl))) {
      reasons.push(`Label indicates complexity: ${label.name}`);
      estimatedTasks += 2;
    }
  }

  const isComplex = reasons.length >= 2 || subsystems.length > 1 || estimatedTasks >= 4;

  return {
    isComplex,
    reasons,
    subsystems,
    estimatedTasks: Math.max(estimatedTasks, subsystems.length + 1),
  };
}

/**
 * Run discovery phase - ask clarifying questions
 */
async function runDiscoveryPhase(
  issue: LinearIssue,
  complexity: ComplexityAnalysis,
  prdContent?: string
): Promise<{ tasks: PlanTask[]; decisions: DiscoveryDecision[] }> {
  const decisions: DiscoveryDecision[] = [];
  const tasks: PlanTask[] = [];

  console.log('');
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('                    DISCOVERY PHASE'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log('');
  console.log(chalk.dim('Answer questions to create a detailed execution plan.'));
  console.log(chalk.dim('Press Enter to skip optional questions.'));
  console.log('');

  // Show what we know
  console.log(chalk.bold('Issue:'), `${issue.identifier} - ${issue.title}`);
  if (complexity.subsystems.length > 0) {
    console.log(chalk.bold('Detected subsystems:'), complexity.subsystems.join(', '));
  }
  console.log('');

  // Q1: Scope clarification
  const scopeAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'scope',
    message: 'What specific changes are needed? (be specific about files/components):',
    default: issue.description?.slice(0, 100) || '',
  }]);
  if (scopeAnswer.scope) {
    decisions.push({ question: 'Scope', answer: scopeAnswer.scope });
  }

  // Q2: Technical approach
  const approachAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'approach',
    message: 'Any specific technical approach or patterns to follow?',
  }]);
  if (approachAnswer.approach) {
    decisions.push({ question: 'Technical approach', answer: approachAnswer.approach });
  }

  // Q3: Edge cases
  const edgeCasesAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'edgeCases',
    message: 'Any edge cases or error scenarios to handle?',
  }]);
  if (edgeCasesAnswer.edgeCases) {
    decisions.push({ question: 'Edge cases', answer: edgeCasesAnswer.edgeCases });
  }

  // Q4: Testing requirements
  const testingAnswer = await inquirer.prompt([{
    type: 'checkbox',
    name: 'testing',
    message: 'What testing is required?',
    choices: [
      { name: 'Unit tests', value: 'unit', checked: true },
      { name: 'Integration tests', value: 'integration' },
      { name: 'E2E tests (Playwright)', value: 'e2e' },
      { name: 'Manual testing only', value: 'manual' },
    ],
  }]);
  if (testingAnswer.testing.length > 0) {
    decisions.push({ question: 'Testing', answer: testingAnswer.testing.join(', ') });
  }

  // Q5: Out of scope
  const outOfScopeAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'outOfScope',
    message: 'Anything explicitly OUT of scope for this issue?',
  }]);
  if (outOfScopeAnswer.outOfScope) {
    decisions.push({ question: 'Out of scope', answer: outOfScopeAnswer.outOfScope });
  }

  // Q6: Define tasks
  console.log('');
  console.log(chalk.bold('Define execution tasks:'));
  console.log(chalk.dim('Enter tasks in order. Empty task name to finish.'));
  console.log('');

  // Start with standard tasks based on complexity
  const suggestedTasks: PlanTask[] = [
    { name: 'Understand requirements', description: 'Review issue, PRD, and existing code' },
  ];

  if (complexity.subsystems.length > 1) {
    suggestedTasks.push({ name: 'Design approach', description: 'Document architecture decisions', dependsOn: 'Understand requirements' });
  }

  for (const subsystem of complexity.subsystems) {
    suggestedTasks.push({
      name: `Implement ${subsystem}`,
      description: `Core ${subsystem} changes`,
      dependsOn: complexity.subsystems.length > 1 ? 'Design approach' : 'Understand requirements',
    });
  }

  if (suggestedTasks.length === 1) {
    suggestedTasks.push({ name: 'Implement changes', description: 'Core implementation', dependsOn: 'Understand requirements' });
  }

  if (testingAnswer.testing.includes('unit') || testingAnswer.testing.includes('integration')) {
    suggestedTasks.push({ name: 'Add tests', description: 'Unit and/or integration tests', dependsOn: suggestedTasks[suggestedTasks.length - 1].name });
  }

  if (testingAnswer.testing.includes('e2e')) {
    suggestedTasks.push({ name: 'Add E2E tests', description: 'Playwright E2E tests', dependsOn: 'Add tests' });
  }

  suggestedTasks.push({ name: 'Verify and cleanup', description: 'Lint, type check, final review', dependsOn: suggestedTasks[suggestedTasks.length - 1].name });

  // Show suggested tasks and let user modify
  console.log(chalk.bold('Suggested tasks:'));
  for (let i = 0; i < suggestedTasks.length; i++) {
    const task = suggestedTasks[i];
    console.log(`  ${i + 1}. ${task.name}${task.dependsOn ? chalk.dim(` (after: ${task.dependsOn})`) : ''}`);
  }
  console.log('');

  const useDefaultAnswer = await inquirer.prompt([{
    type: 'confirm',
    name: 'useDefault',
    message: 'Use these suggested tasks?',
    default: true,
  }]);

  if (useDefaultAnswer.useDefault) {
    tasks.push(...suggestedTasks);
  } else {
    // Custom task entry
    let taskIndex = 1;
    let previousTask = '';

    while (true) {
      const taskAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: `Task ${taskIndex} name (empty to finish):`,
      }]);

      if (!taskAnswer.name) break;

      const descAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'description',
        message: `Task ${taskIndex} description:`,
        default: taskAnswer.name,
      }]);

      tasks.push({
        name: taskAnswer.name,
        description: descAnswer.description,
        dependsOn: previousTask || undefined,
      });

      previousTask = taskAnswer.name;
      taskIndex++;
    }
  }

  return { tasks, decisions };
}

/**
 * Generate STATE.md content
 */
function generateStateFile(
  issue: LinearIssue,
  decisions: DiscoveryDecision[],
  tasks: PlanTask[]
): string {
  const lines: string[] = [
    `# Agent State: ${issue.identifier}`,
    '',
    `**Last Updated:** ${new Date().toISOString()}`,
    '',
    '## Current Position',
    '',
    `- **Issue:** ${issue.identifier}`,
    `- **Title:** ${issue.title}`,
    `- **Status:** Planning complete, ready for execution`,
    `- **Linear:** ${issue.url}`,
    '',
    '## Decisions Made During Planning',
    '',
  ];

  if (decisions.length > 0) {
    for (const decision of decisions) {
      lines.push(`- **${decision.question}:** ${decision.answer}`);
    }
  } else {
    lines.push('- No specific decisions recorded');
  }

  lines.push('');
  lines.push('## Planned Tasks');
  lines.push('');

  for (const task of tasks) {
    lines.push(`- [ ] ${task.name}${task.dependsOn ? ` (after: ${task.dependsOn})` : ''}`);
  }

  lines.push('');
  lines.push('## Blockers/Concerns');
  lines.push('');
  lines.push('- None identified during planning');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('<!-- Add notes as work progresses -->');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate WORKSPACE.md content
 */
function generateWorkspaceFile(issue: LinearIssue, prdFiles: string[]): string {
  const lines: string[] = [
    `# Workspace: ${issue.identifier}`,
    '',
    `> ${issue.title}`,
    '',
    '## Quick Links',
    '',
    `- [Linear Issue](${issue.url})`,
  ];

  for (const prd of prdFiles) {
    const relativePath = prd.replace(process.cwd() + '/', '');
    lines.push(`- [PRD](${relativePath})`);
  }

  lines.push('');
  lines.push('## Context Files');
  lines.push('');
  lines.push('- `STATE.md` - Current progress and decisions');
  lines.push('- `WORKSPACE.md` - This file');
  lines.push('');
  lines.push('## Beads');
  lines.push('');
  lines.push('Check current task status:');
  lines.push('```bash');
  lines.push('bd ready  # Next actionable task');
  lines.push(`bd list --tag ${issue.identifier}  # All tasks for this issue`);
  lines.push('```');
  lines.push('');
  lines.push('## Agent Instructions');
  lines.push('');
  lines.push('1. Run `bd ready` to get next task');
  lines.push('2. Complete the task following relevant skills');
  lines.push('3. Run `bd close "<task name>" --reason "..."` when done');
  lines.push('4. Update STATE.md with progress');
  lines.push('5. Repeat until all tasks complete');
  lines.push('');
  lines.push('## CRITICAL: Work Completion Requirements');
  lines.push('');
  lines.push('**You are NOT done until ALL of these are true:**');
  lines.push('');
  lines.push('1. **Tests pass** - Run the full test suite');
  lines.push('2. **All changes committed** - `git status` shows "nothing to commit"');
  lines.push('3. **Pushed to remote** - `git push`');
  lines.push('');
  lines.push('**Uncommitted changes = NOT COMPLETE.**');
  lines.push('');

  return lines.join('\n');
}

/**
 * Create Beads tasks with dependencies
 */
async function createBeadsTasks(issue: LinearIssue, tasks: PlanTask[]): Promise<{ success: boolean; created: string[]; errors: string[] }> {
  const created: string[] = [];
  const errors: string[] = [];
  const taskIds: Map<string, string> = new Map();

  // Check if bd is available
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return { success: false, created: [], errors: ['bd (beads) CLI not found in PATH'] };
  }

  for (const task of tasks) {
    const fullName = `${issue.identifier}: ${task.name}`;

    try {
      // Build bd create command with correct flags
      // bd create "title" --type task -l label1,label2 -d "description" --deps "blocks:id"
      const escapedName = fullName.replace(/"/g, '\\"');
      let cmd = `bd create "${escapedName}" --type task -l "${issue.identifier},linear"`;

      // Add dependency if specified (format: blocks:id)
      if (task.dependsOn) {
        const depName = `${issue.identifier}: ${task.dependsOn}`;
        const depId = taskIds.get(depName);
        if (depId) {
          cmd += ` --deps "blocks:${depId}"`;
        }
      }

      // Add description
      if (task.description) {
        const escapedDesc = task.description.replace(/"/g, '\\"');
        cmd += ` -d "${escapedDesc}"`;
      }

      const { stdout: result } = await execAsync(cmd, { encoding: 'utf-8', cwd: process.cwd() });

      // Extract ID from output - bd outputs "Created: bd-XXXX" or similar
      const idMatch = result.match(/bd-[a-f0-9]+/i) || result.match(/([a-f0-9-]{8,})/i);
      if (idMatch) {
        taskIds.set(fullName, idMatch[0]);
      }

      created.push(fullName);
    } catch (error: any) {
      // Extract meaningful error from stderr
      const errMsg = error.stderr?.toString() || error.message;
      errors.push(`Failed to create "${task.name}": ${errMsg.split('\n')[0]}`);
    }
  }

  // Sync beads to git (bd uses 'bd flush' to export to JSONL)
  if (created.length > 0) {
    try {
      await execAsync('bd flush', { encoding: 'utf-8', cwd: process.cwd() });
    } catch {
      // Flush might fail if no changes, that's OK
    }
  }

  return { success: errors.length === 0, created, errors };
}

/**
 * Copy plan to PRD directory
 */
function copyToPRDDirectory(issue: LinearIssue, stateContent: string): string | null {
  const cwd = process.cwd();
  const prdDir = join(cwd, 'docs', 'prds', 'active');

  try {
    mkdirSync(prdDir, { recursive: true });

    const filename = `${issue.identifier.toLowerCase()}-plan.md`;
    const prdPath = join(prdDir, filename);

    writeFileSync(prdPath, stateContent);

    return prdPath;
  } catch {
    return null;
  }
}

export async function planCommand(id: string, options: PlanOptions = {}): Promise<void> {
  const spinner = ora(`Creating execution plan for ${id}...`).start();

  try {
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      spinner.fail('LINEAR_API_KEY not found');
      console.log('');
      console.log(chalk.dim('Set it in ~/.panopticon.env:'));
      console.log('  LINEAR_API_KEY=lin_api_xxxxx');
      process.exit(1);
    }

    // Fetch issue from Linear
    spinner.text = 'Fetching issue from Linear...';
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    const me = await client.viewer;
    const teams = await me.teams();
    const team = teams.nodes[0];

    if (!team) {
      spinner.fail('No Linear team found');
      process.exit(1);
    }

    const searchResult = await team.issues({ first: 100 });
    const issue = searchResult.nodes.find(
      (i) => i.identifier.toUpperCase() === id.toUpperCase()
    );

    if (!issue) {
      spinner.fail(`Issue not found: ${id}`);
      process.exit(1);
    }

    const state = await issue.state;
    const assignee = await issue.assignee;
    const project = await issue.project;
    const labels = await issue.labels();

    const issueData: LinearIssue = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || undefined,
      state: { name: state?.name || 'Unknown' },
      priority: issue.priority,
      url: issue.url,
      labels: labels.nodes.map(l => ({ name: l.name })),
      assignee: assignee ? { name: assignee.name } : undefined,
      project: project ? { name: project.name } : undefined,
    };

    // Look for related PRD files
    spinner.text = 'Searching for related PRDs...';
    const prdFiles = await findPRDFiles(id);

    // Analyze complexity
    spinner.text = 'Analyzing complexity...';
    const complexity = analyzeComplexity(issueData, prdFiles);

    spinner.stop();

    // Show complexity analysis
    console.log('');
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    console.log(chalk.bold(`  ${issueData.identifier}: ${issueData.title}`));
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    console.log('');

    console.log(chalk.bold('Complexity Analysis:'));
    console.log(`  Level: ${complexity.isComplex ? chalk.yellow('COMPLEX') : chalk.green('SIMPLE')}`);
    console.log(`  Estimated tasks: ${complexity.estimatedTasks}`);
    if (complexity.subsystems.length > 0) {
      console.log(`  Subsystems: ${complexity.subsystems.join(', ')}`);
    }
    if (complexity.reasons.length > 0) {
      console.log(`  Reasons:`);
      for (const reason of complexity.reasons) {
        console.log(`    - ${reason}`);
      }
    }
    console.log('');

    if (prdFiles.length > 0) {
      console.log(chalk.bold('Related PRDs found:'));
      for (const prd of prdFiles) {
        console.log(`  - ${prd.replace(process.cwd() + '/', '')}`);
      }
      console.log('');
    }

    // For simple issues, offer to skip planning
    if (!complexity.isComplex && !options.force) {
      const skipAnswer = await inquirer.prompt([{
        type: 'confirm',
        name: 'skip',
        message: 'This looks simple. Skip planning and go straight to /work-issue?',
        default: true,
      }]);

      if (skipAnswer.skip) {
        console.log('');
        console.log(chalk.cyan(`Run: pan work issue ${id}`));
        console.log('');
        return;
      }
    }

    // Run discovery phase
    let tasks: PlanTask[];
    let decisions: DiscoveryDecision[];

    if (options.skipDiscovery) {
      // Use default tasks based on complexity
      tasks = [
        { name: 'Understand requirements', description: 'Review issue and existing code' },
        { name: 'Implement changes', description: 'Core implementation', dependsOn: 'Understand requirements' },
        { name: 'Add tests', description: 'Unit/integration tests', dependsOn: 'Implement changes' },
        { name: 'Verify and cleanup', description: 'Lint, type check, final review', dependsOn: 'Add tests' },
      ];
      decisions = [];
    } else {
      const discovery = await runDiscoveryPhase(issueData, complexity);
      tasks = discovery.tasks;
      decisions = discovery.decisions;
    }

    // Generate context files
    const spinnerCreate = ora('Creating context files...').start();

    const stateContent = generateStateFile(issueData, decisions, tasks);
    const workspaceContent = generateWorkspaceFile(issueData, prdFiles);

    // Determine output directory (workspace or current)
    const outputDir = options.output ? dirname(options.output) : process.cwd();
    const planningDir = join(outputDir, '.planning');
    mkdirSync(planningDir, { recursive: true });

    // Write STATE.md
    const statePath = join(planningDir, 'STATE.md');
    writeFileSync(statePath, stateContent);

    // Write WORKSPACE.md
    const workspacePath = join(planningDir, 'WORKSPACE.md');
    writeFileSync(workspacePath, workspaceContent);

    spinnerCreate.succeed('Context files created');

    // Create Beads tasks
    const spinnerBeads = ora('Creating Beads tasks...').start();
    const beadsResult = await createBeadsTasks(issueData, tasks);

    if (beadsResult.success) {
      spinnerBeads.succeed(`Created ${beadsResult.created.length} Beads tasks`);
    } else {
      spinnerBeads.warn(`Created ${beadsResult.created.length} tasks with errors`);
      for (const error of beadsResult.errors) {
        console.log(chalk.red(`  - ${error}`));
      }
    }

    // Copy to PRD directory
    const prdPath = copyToPRDDirectory(issueData, stateContent);
    if (prdPath) {
      console.log(chalk.dim(`Plan copied to: ${prdPath.replace(process.cwd() + '/', '')}`));
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({
        issue: issueData,
        complexity,
        tasks,
        decisions,
        files: {
          state: statePath,
          workspace: workspacePath,
          prd: prdPath,
        },
        beads: beadsResult,
      }, null, 2));
      return;
    }

    // Summary
    console.log('');
    console.log(chalk.bold.green('═══════════════════════════════════════════════════════════'));
    console.log(chalk.bold.green('                    PLAN COMPLETE'));
    console.log(chalk.bold.green('═══════════════════════════════════════════════════════════'));
    console.log('');

    console.log(chalk.bold('Files created:'));
    console.log(`  ${chalk.cyan(statePath.replace(process.cwd() + '/', ''))}`);
    console.log(`  ${chalk.cyan(workspacePath.replace(process.cwd() + '/', ''))}`);
    console.log('');

    console.log(chalk.bold('Beads tasks:'));
    for (const task of tasks) {
      console.log(`  ${chalk.dim('○')} ${issueData.identifier}: ${task.name}`);
    }
    console.log('');

    if (decisions.length > 0) {
      console.log(chalk.bold('Decisions recorded:'));
      for (const decision of decisions) {
        console.log(`  - ${decision.question}: ${chalk.dim(decision.answer.slice(0, 50))}${decision.answer.length > 50 ? '...' : ''}`);
      }
      console.log('');
    }

    console.log(chalk.bold('Next steps:'));
    console.log(`  1. Review ${chalk.cyan('.planning/STATE.md')}`);
    console.log(`  2. Run ${chalk.cyan(`pan work issue ${id}`)} to spawn agent`);
    console.log(`  3. Agent will use ${chalk.cyan('bd ready')} to get tasks`);
    console.log('');

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}
