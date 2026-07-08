import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { spawnRun } from '../../lib/agents.js';
import { ensureMnemos } from '../../lib/installers/mnemos.js';
import { loadProjectsConfigSync, resolveProjectFromIssueSync } from '../../lib/projects.js';
import type { RoleEffort } from '../../lib/config-yaml.js';

export interface KnowledgeOptions {
  focus?: string;
  retro?: boolean;
  model?: string;
  effort?: RoleEffort;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveBundlePath(projectPath: string, bundlePath: string): string {
  return resolve(projectPath, bundlePath);
}

async function resolveKnowledgeBundlePath(projectKey: string, projectPath: string): Promise<string | null> {
  const projectConfig = loadProjectsConfigSync().projects[projectKey];
  if (typeof projectConfig?.knowledge_repo === 'string' && projectConfig.knowledge_repo.trim()) {
    return resolveBundlePath(projectPath, projectConfig.knowledge_repo);
  }

  try {
    const pointer = parseYaml(await readFile(join(projectPath, '.okf.yml'), 'utf8'));
    if (isRecord(pointer) && typeof pointer.bundle === 'string' && pointer.bundle.trim()) {
      return resolveBundlePath(projectPath, pointer.bundle);
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  return null;
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

    const bundlePath = await resolveKnowledgeBundlePath(project.projectKey, project.projectPath);
    await ensureMnemos({ bundlePath: bundlePath ?? undefined });

    const agent = await spawnRun(normalized, 'knowledge', {
      workspace: project.projectPath,
      model: options.model,
      effort: options.effort,
      extraEnvExports: ['export PATH="$HOME/.overdeck/bin:$PATH"'],
      prompt: buildKnowledgePrompt(normalized, options),
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

export function configureKnowledgeCommand(program: Command): Command {
  return program
    .command('knowledge <id>')
    .description('Spawn a knowledge agent to maintain the project OKF bundle')
    .option('--focus <topic>', 'Run /okf study for a focused topic before syncing')
    .option('--retro', 'Run /okf retro before syncing')
    .option('--model <model>', 'Model override (defaults to roles.knowledge.model from config)')
    .option('--effort <level>', 'Knowledge effort: low | medium | high | xhigh | max')
    .action((id: string, options: KnowledgeOptions) => knowledgeCommand(id, options));
}
