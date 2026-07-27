import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';

import { spawnRun } from '../../lib/agents.js';
import { ensureMnemos } from '../../lib/installers/mnemos.js';
import {
  ensureOpenKnowledge,
  executeOpenKnowledgeSetupPlan,
  OpenKnowledgeSetupRequiredError,
  startReadOnlyOpenKnowledgeServer,
  type EnsureOpenKnowledgeResult,
  type OpenKnowledgeSetupPlan,
  type StartOpenKnowledgeServerResult,
} from '../../lib/installers/open-knowledge.js';
import { resolveKnowledgeBundleRoot } from '../../lib/memory/injection.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import type { RoleEffort } from '../../lib/config-yaml.js';

export interface KnowledgeOptions {
  focus?: string;
  retro?: boolean;
  model?: string;
  effort?: RoleEffort;
}

export interface KnowledgeOpenOptions {
  install?: boolean;
  browser?: boolean;
}

export interface KnowledgeOpenDependencies {
  cwd?: () => string;
  ensure?: (options: { autoInstall: boolean }) => Promise<EnsureOpenKnowledgeResult>;
  executeSetupPlan?: (plan: OpenKnowledgeSetupPlan) => Promise<string>;
  start?: (bundlePath: string, options: { openBrowser: false; okCommand?: string }) => Promise<StartOpenKnowledgeServerResult>;
  prompt?: (question: string) => Promise<string>;
  isTTY?: () => boolean;
  openBrowser?: (url: string) => Promise<void>;
}

function normalizeIssueId(issueId: string): string {
  return issueId.toUpperCase();
}

function quoteShellText(value: string): string {
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildKnowledgePrompt(issueId: string, options: KnowledgeOptions = {}): string {
  const normalized = normalizeIssueId(issueId);
  const focus = options.focus?.trim();
  const commands: string[] = [];

  if (focus) {
    commands.push(`/okf study ${quoteShellText(focus)}`);
  }
  if (options.retro) {
    commands.push('/okf retro');
  }
  if (commands.length === 0) {
    commands.push('/okf sync');
  } else {
    commands.push(focus ? `/okf sync --topic ${quoteShellText(focus)}` : '/okf sync');
  }

  return [
    `# Knowledge maintenance: ${normalized}`,
    '',
    'You are a knowledge agent. Read `roles/knowledge.md` for the full contract.',
    '',
    '## Assignment',
    '',
    `- Issue: ${normalized}`,
    focus ? `- Focus: ${focus}` : '- Focus: project knowledge maintenance',
    options.retro ? '- Retro capture requested: yes' : '- Retro capture requested: no',
    '',
    '## Required OKF commands',
    '',
    ...commands.map((command, index) => `${index + 1}. Run \`${command}\`.`),
    '',
    'After the commands finish, report the knowledge PR status or explain why no PR was opened.',
    'Do not run `pan done`, transition pipeline state, or merge any PR yourself.',
  ].join('\n');
}

export async function knowledgeCommand(issueId: string, options: KnowledgeOptions = {}): Promise<void> {
  const normalized = normalizeIssueId(issueId);
  const spinner = ora(`Spawning knowledge agent for ${normalized}...`).start();

  try {
    const project = resolveProjectFromIssueSync(normalized);
    if (!project) {
      throw new Error(`No Overdeck project is configured for issue prefix in "${normalized}". Add the project to projects.yaml first.`);
    }

    const bundlePath = await resolveKnowledgeBundleRoot({ projectPath: project.projectPath });
    if (!bundlePath) {
      throw new Error(
        `No OKF bundle is configured for ${project.projectName}. ` +
          `Run \`/okf init\` in this workspace to create or connect a knowledge bundle, ` +
          `then retry \`pan knowledge ${normalized}\`.`,
      );
    }
    try {
      await ensureMnemos({ bundlePath });
    } catch (error: unknown) {
      spinner.warn(`mnemos unavailable; spawning knowledge agent with built-in OKF search: ${errorMessage(error)}`);
      spinner.start(`Spawning knowledge agent for ${normalized}...`);
    }

    const agent = await spawnRun(normalized, 'knowledge', {
      workspace: project.projectPath,
      model: options.model,
      effort: options.effort,
      extraEnvExports: ['export PATH="$HOME/.overdeck/bin:$PATH"'],
      prompt: buildKnowledgePrompt(normalized, options),
      startedBy: 'operator:cli:pan-knowledge',
    });

    spinner.succeed(`Knowledge agent spawned: ${agent.id}`);
    console.log('');
    console.log(chalk.bold('Knowledge Details:'));
    console.log(`  Session:    ${chalk.cyan(agent.id)}`);
    console.log(`  Workspace:  ${project.projectPath}`);
    console.log(`  Model:      ${agent.model}`);
    if (options.focus) console.log(`  Focus:      ${options.focus}`);
    if (options.retro) console.log('  Retro:      yes');
    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  Message:  pan tell ${normalized.toLowerCase()} "your message"`);
    console.log(`  Kill:     pan kill ${normalized.toLowerCase()}`);
  } catch (error: unknown) {
    spinner.fail(`Knowledge agent for ${normalized} failed: ${errorMessage(error)}`);
    throw error;
  }
}

export async function knowledgeOpenCommand(
  options: KnowledgeOpenOptions = {},
  dependencies: KnowledgeOpenDependencies = {},
): Promise<void> {
  const cwd = dependencies.cwd?.() ?? process.cwd();
  const bundlePath = await resolveKnowledgeBundleRoot({ projectPath: cwd });
  if (!bundlePath) {
    throw new Error('No OKF bundle is configured for this project. Run `/okf init` first, then retry `pan knowledge open`.');
  }

  const ensure = dependencies.ensure ?? ensureOpenKnowledge;
  const start = dependencies.start ?? startReadOnlyOpenKnowledgeServer;
  const autoInstall = options.install !== false;
  let installation: EnsureOpenKnowledgeResult;
  try {
    installation = await ensure({ autoInstall });
  } catch (error) {
    if (!autoInstall || !(error instanceof OpenKnowledgeSetupRequiredError)) throw error;
    const plan = error.plan;
    for (const step of plan.steps) console.log(step);
    const manualCommand = plan.kind === 'install-nvm' ? plan.manualCommand : plan.installCommand;
    if (!(dependencies.isTTY?.() ?? process.stdin.isTTY === true)) {
      throw new Error(`${plan.steps.join('\n')}\nRun manually: ${manualCommand}`);
    }

    const answer = await (dependencies.prompt ?? promptForKnowledgeSetup)('Proceed? [y/N] ');
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      console.log(`Manual setup: ${manualCommand}`);
      return;
    }

    await (dependencies.executeSetupPlan ?? executeOpenKnowledgeSetupPlan)(plan);
    installation = await ensure({ autoInstall });
  }
  const viewer = await start(bundlePath, { openBrowser: false, okCommand: installation.command });
  viewer.process?.unref();

  console.log(`Knowledge viewer: ${viewer.url}${viewer.reused ? ' (reused)' : ''}`);
  if (options.browser === false) return;

  try {
    await (dependencies.openBrowser ?? openViewerInBrowser)(viewer.url);
  } catch (error: unknown) {
    console.warn(`Could not open the browser automatically: ${errorMessage(error)}`);
  }
}

async function promptForKnowledgeSetup(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

async function openViewerInBrowser(url: string): Promise<void> {
  const [{ Effect }, { openBrowser }, { layer: nodeServicesLayer }] = await Promise.all([
    import('effect'),
    import('../../lib/browser.js'),
    import('@effect/platform-node/NodeServices'),
  ]);
  await Effect.runPromise(openBrowser(url).pipe(Effect.provide(nodeServicesLayer)));
}

export function configureKnowledgeCommand(program: Command): Command {
  const command = program
    .command('knowledge')
    .description('Maintain or open the project OKF bundle')
    .argument('[id]', 'Issue ID for a knowledge maintenance agent')
    .option('--focus <topic>', 'Run /okf study for a focused topic before syncing')
    .option('--retro', 'Run /okf retro before syncing')
    .option('--model <model>', 'Model override (defaults to roles.knowledge.model from config)')
    .option('--effort <level>', 'Knowledge effort: low | medium | high | xhigh | max')
    .action((id: string | undefined, options: KnowledgeOptions) => {
      if (!id) {
        command.help();
        return;
      }
      return knowledgeCommand(id, options);
    });

  command
    .command('open')
    .description('Open the project OKF bundle in the local knowledge viewer')
    .option('--no-install', 'Do not install @inkeep/open-knowledge when the ok binary is missing')
    .option('--no-browser', 'Start or reuse the viewer without opening a browser')
    .action((options: KnowledgeOpenOptions) => knowledgeOpenCommand(options));

  return command;
}
