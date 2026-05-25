import { resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import type { ArtifactAgentHarness, ArtifactAgentRole, ArtifactValidationResult } from '@panctl/contracts';
import {
  createArtifact,
  getArtifactStatus,
  publishArtifact,
  resolveArtifactUrl,
  unshareArtifact,
} from '../../lib/artifacts/lifecycle.js';

interface ArtifactCreateOptions {
  issue?: string;
  workspace?: string;
  agentRole?: string;
  agentHarness?: string;
  runId?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  strict?: boolean;
  json?: boolean;
}

interface ArtifactPublishOptions {
  strict?: boolean;
  json?: boolean;
}

interface ArtifactUnshareOptions {
  yes?: boolean;
  json?: boolean;
}

interface ArtifactShareOptions {
  tunnel?: boolean;
  json?: boolean;
}

export function registerArtifactCommands(program: Command): void {
  const artifacts = program
    .command('artifacts')
    .description('Create, publish, and unshare browser-viewable HTML artifacts');

  artifacts
    .command('create <file>')
    .description('Validate and publish an HTML artifact')
    .option('--issue <id>', 'Issue ID for artifact provenance')
    .option('--workspace <id>', 'Workspace ID for artifact provenance')
    .option('--agent-role <role>', 'Agent role: plan, work, review, test, ship, flywheel, or user')
    .option('--agent-harness <harness>', 'Agent harness: claude-code, pi, or user')
    .option('--run-id <id>', 'Run ID for artifact provenance')
    .option('--session-id <id>', 'Session ID for artifact provenance')
    .option('--title <title>', 'Artifact title')
    .option('--description <text>', 'Artifact description')
    .option('--strict', 'Enable strict validation warnings')
    .option('--json', 'Emit JSON result')
    .action((file: string, options: ArtifactCreateOptions) => runArtifactCommand(() => artifactCreateCommand(file, options), options));

  artifacts
    .command('publish <file>')
    .description('Revalidate and republish an existing artifact when changes are pending')
    .option('--strict', 'Enable strict validation warnings')
    .option('--json', 'Emit JSON result')
    .action((file: string, options: ArtifactPublishOptions) => runArtifactCommand(() => artifactPublishCommand(file, options), options));

  artifacts
    .command('unshare <file>')
    .description('Disable an artifact URL without deleting source, snapshots, or metadata')
    .option('--yes', 'Confirm unsharing without an interactive prompt')
    .option('--json', 'Emit JSON result')
    .action((file: string, options: ArtifactUnshareOptions) => runArtifactCommand(() => artifactUnshareCommand(file, options), options));

  artifacts
    .command('share <file>')
    .description('Share an artifact through an external tunnel')
    .option('--tunnel', 'Request tunnel-backed sharing')
    .option('--json', 'Emit JSON result')
    .action((file: string, options: ArtifactShareOptions) => runArtifactCommand(() => artifactShareCommand(file, options), options));
}

export async function artifactCreateCommand(file: string, options: ArtifactCreateOptions): Promise<void> {
  const agentRole = parseAgentRole(options.agentRole);
  const agentHarness = parseAgentHarness(options.agentHarness);
  const result = await createArtifact(resolve(file), {
    issueId: options.issue,
    workspaceId: options.workspace,
    agentRole,
    agentHarness,
    runId: options.runId,
    sessionId: options.sessionId,
    title: options.title,
    description: options.description,
    validation: { strict: options.strict === true },
  });

  if (options.json) {
    printJson(result);
    return;
  }

  console.log(chalk.green('✓ Artifact published'));
  console.log(chalk.dim(`  Slug:    ${result.artifact.slug}`));
  console.log(chalk.dim(`  Wrapper: ${result.urls.wrapperUrl}`));
  console.log(chalk.dim(`  Raw:     ${result.urls.rawUrl}`));
  console.log(chalk.dim(`  Hash:    ${result.artifact.currentHash}`));
}

export async function artifactPublishCommand(file: string, options: ArtifactPublishOptions): Promise<void> {
  const filePath = resolve(file);
  const status = await getArtifactStatus(filePath, { validation: { strict: options.strict === true } });
  ensureValidationOk(status.validation);

  if (status.artifact && !status.pendingChanges && !status.artifact.unsharedAt) {
    const urls = resolveArtifactUrl(status.artifact.slug);
    const result = {
      artifact: status.artifact,
      filePath: status.filePath,
      currentHash: status.currentHash,
      lastPublishedHash: status.lastPublishedHash,
      pendingChanges: false,
      published: false,
      urls,
      message: 'No pending changes',
    };

    if (options.json) {
      printJson(result);
      return;
    }

    console.log(chalk.yellow('No pending changes'));
    console.log(chalk.dim(`  Slug:    ${status.artifact.slug}`));
    console.log(chalk.dim(`  Wrapper: ${urls.wrapperUrl}`));
    console.log(chalk.dim(`  Hash:    ${status.currentHash}`));
    return;
  }

  const result = await publishArtifact(filePath, { validation: { strict: options.strict === true } });

  if (options.json) {
    printJson(result);
    return;
  }

  console.log(chalk.green('✓ Artifact published'));
  console.log(chalk.dim(`  Slug:    ${result.artifact.slug}`));
  console.log(chalk.dim(`  Wrapper: ${result.urls.wrapperUrl}`));
  console.log(chalk.dim(`  Raw:     ${result.urls.rawUrl}`));
  console.log(chalk.dim(`  Hash:    ${result.artifact.currentHash}`));
}

export async function artifactUnshareCommand(file: string, options: ArtifactUnshareOptions): Promise<void> {
  if (!options.yes) {
    if (options.json || !process.stdin.isTTY) {
      throw new Error('Refusing to unshare without --yes in JSON or non-interactive mode');
    }

    const confirmed = await confirmUnshare(resolve(file));
    if (!confirmed) {
      console.log(chalk.yellow('Unshare cancelled'));
      return;
    }
  }

  const result = unshareArtifact(resolve(file));

  if (options.json) {
    printJson(result);
    return;
  }

  console.log(chalk.green('✓ Artifact unshared'));
  console.log(chalk.dim(`  Slug:       ${result.artifact.slug}`));
  console.log(chalk.dim(`  UnsharedAt: ${result.artifact.unsharedAt}`));
}

export async function artifactShareCommand(file: string, options: ArtifactShareOptions): Promise<void> {
  if (!options.tunnel) {
    throw new Error('Specify --tunnel to request tunnel-backed artifact sharing');
  }

  const result = {
    filePath: resolve(file),
    shared: false,
    error: 'tunneling not yet supported',
  };

  if (options.json) {
    printJson(result);
  } else {
    console.error(chalk.red('tunneling not yet supported'));
  }

  process.exit(1);
}

async function runArtifactCommand(action: () => Promise<void>, options: { json?: boolean }): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (options.json) {
      printJson(formatError(error));
    } else {
      printError(error);
    }
    process.exit(1);
  }
}

function ensureValidationOk(validation: ArtifactValidationResult | undefined): void {
  if (!validation || validation.ok) return;
  throw Object.assign(new Error('Artifact HTML validation failed'), { validation });
}

async function confirmUnshare(filePath: string): Promise<boolean> {
  const { default: inquirer } = await import('inquirer');
  const answer = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Unshare artifact for ${filePath}?`,
      default: false,
    },
  ]);
  return answer.confirmed;
}

function parseAgentRole(value: string | undefined): ArtifactAgentRole | undefined {
  if (value === undefined) return undefined;
  if (value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship' || value === 'flywheel' || value === 'user') {
    return value;
  }
  throw new Error(`Invalid --agent-role: ${value}`);
}

function parseAgentHarness(value: string | undefined): ArtifactAgentHarness | undefined {
  if (value === undefined) return undefined;
  if (value === 'claude-code' || value === 'pi' || value === 'user') return value;
  throw new Error(`Invalid --agent-harness: ${value}`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printError(error: unknown): void {
  const formatted = formatError(error);
  console.error(chalk.red(`Error: ${formatted.error}`));

  if (formatted.validation) {
    for (const finding of formatted.validation.errors) {
      const location = finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ''}` : '';
      console.error(chalk.dim(`  [${finding.code}]${location} ${finding.message}`));
    }
  }
}

function formatError(error: unknown): { ok: false; error: string; validation?: ArtifactValidationResult } {
  const maybeValidation = error as { validation?: ArtifactValidationResult; message?: string };
  return {
    ok: false,
    error: maybeValidation.message ?? String(error),
    ...(maybeValidation.validation ? { validation: maybeValidation.validation } : {}),
  };
}
