import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { join, dirname } from 'path';
import { shouldSkipTrackerUpdate } from '../../lib/shadow-mode.js';
import { createShadowState } from '../../lib/shadow-state.js';
import { resolveGitHubIssue, resolveTrackerType } from '../../lib/tracker-utils.js';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import {
  findPRDFiles,
  analyzeComplexity,
  executePlan,
  type PlanIssue,
  type PlanTask,
  type DiscoveryDecision,
  type ComplexityAnalysis,
} from '../../lib/planning/plan-utils.js';

interface PlanOptions {
  output?: string;
  json?: boolean;
  skipDiscovery?: boolean;
  force?: boolean;
  shadow?: boolean;
}

/**
 * Run discovery phase - ask clarifying questions
 */
async function runDiscoveryPhase(
  issue: PlanIssue,
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

export async function planCommand(id: string, options: PlanOptions = {}): Promise<void> {
  const spinner = ora(`Creating execution plan for ${id}...`).start();

  try {
    // Resolve tracker type from project config
    const trackerType = resolveTrackerType(id);
    const ghResolution = resolveGitHubIssue(id);
    let issueData: PlanIssue;

    if (trackerType === 'github' && ghResolution.isGitHub) {
      // Fetch from GitHub
      spinner.text = 'Fetching issue from GitHub...';
      const { loadConfig: loadYamlConfig } = await import('../../lib/config-yaml.js');
      const yamlConfig = loadYamlConfig();
      const token = yamlConfig.config.trackerKeys?.github || process.env.GITHUB_TOKEN;
      if (!token) {
        spinner.fail('GitHub token not found');
        process.exit(1);
      }
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: token });
      const { data: ghIssue } = await octokit.issues.get({
        owner: ghResolution.owner,
        repo: ghResolution.repo,
        issue_number: ghResolution.number,
      });
      issueData = {
        id: String(ghIssue.id),
        identifier: id,
        title: ghIssue.title,
        description: ghIssue.body || undefined,
        url: ghIssue.html_url,
        state: { name: ghIssue.state === 'open' ? 'Todo' : 'Done' },
        priority: 0,
        labels: (ghIssue.labels || []).map(l => ({ name: typeof l === 'string' ? l : l.name || '' })),
        assignee: ghIssue.assignee ? { name: ghIssue.assignee.login } : undefined,
      };
    } else if (trackerType === 'rally') {
      // Fetch from Rally using the tracker factory
      spinner.text = 'Fetching issue from Rally...';
      const { createTracker } = await import('../../lib/tracker/factory.js');
      const { resolveProjectFromIssue } = await import('../../lib/projects.js');

      const project = resolveProjectFromIssue(id);
      const rallyProject = project
        ? (await import('../../lib/projects.js')).getProject(project.projectKey)?.rally_project
        : undefined;

      try {
        const tracker = createTracker({
          type: 'rally',
          project: rallyProject || undefined,
        });
        const rallyIssue = await tracker.getIssue(id);

        issueData = {
          id: rallyIssue.id,
          identifier: rallyIssue.ref,
          title: rallyIssue.title,
          description: rallyIssue.description || undefined,
          url: rallyIssue.url,
          state: { name: rallyIssue.state === 'open' ? 'Todo' : rallyIssue.state === 'closed' ? 'Done' : 'In Progress' },
          priority: rallyIssue.priority || 0,
          labels: rallyIssue.labels.map(l => ({ name: l })),
          assignee: rallyIssue.assignee ? { name: rallyIssue.assignee } : undefined,
        };
      } catch (err: any) {
        spinner.fail(`Rally error: ${err.message}`);
        process.exit(1);
      }
    } else {
      // Fetch from Linear
      const apiKey = getLinearApiKey();
      if (!apiKey) {
        spinner.fail('LINEAR_API_KEY not found');
        console.log('');
        console.log(chalk.dim('Set it in ~/.panopticon.env:'));
        console.log('  LINEAR_API_KEY=lin_api_xxxxx');
        process.exit(1);
      }
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

      issueData = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description || undefined,
        url: issue.url,
        state: { name: state?.name || 'Unknown' },
        priority: issue.priority,
        labels: labels.nodes.map(l => ({ name: l.name })),
        assignee: assignee ? { name: assignee.name } : undefined,
        project: project ? { name: project.name } : undefined,
      };
    }

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
        console.log(chalk.cyan(`Run: pan start ${id}`));
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

    // Execute the plan using shared utilities
    const spinnerCreate = ora('Creating context files...').start();

    const outputDir = options.output ? dirname(options.output) : process.cwd();
    const result = await executePlan(issueData, tasks, decisions, outputDir, {
      prdFiles,
    });

    spinnerCreate.succeed('Context files created');

    if (result.files.prd) {
      console.log(chalk.dim(`Plan copied to: ${result.files.prd.replace(process.cwd() + '/', '')}`));
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({
        issue: issueData,
        complexity,
        tasks,
        decisions,
        files: result.files,
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
    console.log(`  ${chalk.cyan(result.files.state.replace(process.cwd() + '/', ''))}`);
    console.log('');

    console.log(chalk.bold('Tasks:'));
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

    // Check shadow mode
    const skipTrackerUpdate = shouldSkipTrackerUpdate(id, options.shadow);
    if (skipTrackerUpdate) {
      // Create shadow state for the issue
      createShadowState(id, 'open', 'pan plan');
      console.log(chalk.cyan('👻 Shadow mode enabled: status will be tracked locally'));
      console.log('');
    }

    console.log(chalk.bold('Next steps:'));
    console.log(`  1. Review ${chalk.cyan('.planning/STATE.md')}`);
    console.log(`  2. Run ${chalk.cyan(`pan start ${id}`)} to spawn agent`);
    console.log(`  3. Agent will use ${chalk.cyan('bd ready')} to get tasks`);
    console.log('');

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}
