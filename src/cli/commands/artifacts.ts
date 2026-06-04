import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type {
  ArtifactAgentHarness,
  ArtifactAgentRole,
  ArtifactMetadata,
  ArtifactUrls,
  ArtifactValidationResult,
} from '@panctl/contracts';
import type { Command } from 'commander';
import { ArtifactIndexRepository } from '../../lib/artifacts/index-store.js';
import {
  createArtifact,
  getArtifactStatus,
  listArtifacts,
  publishArtifact,
  resolveArtifactUrl,
  unshareArtifact,
} from '../../lib/artifacts/lifecycle.js';
import { validateArtifactHtml } from '../../lib/artifacts/validator.js';

interface JsonOption {
  json?: boolean;
}

interface ValidateOptions extends JsonOption {
  strict?: boolean;
}

interface ListOptions extends JsonOption {
  workspace?: string;
}

interface ArtifactCreateOptions extends JsonOption {
  issue?: string;
  workspace?: string;
  agentRole?: string;
  agentHarness?: string;
  runId?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  strict?: boolean;
}

interface ArtifactPublishOptions extends JsonOption {
  strict?: boolean;
}

interface ArtifactUnshareOptions extends JsonOption {
  yes?: boolean;
}

interface ArtifactShareOptions extends JsonOption {
  tunnel?: boolean;
}

interface ArtifactCommandDeps {
  repository?: ArtifactIndexRepository;
  opener?: (url: string) => void | Promise<void>;
  cwd?: string;
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

export async function artifactValidateCommand(file: string, options: ValidateOptions = {}, deps: ArtifactCommandDeps = {}): Promise<void> {
  const filePath = resolvePath(file, deps.cwd);
  const result = await validateArtifactHtml(filePath, { strict: options.strict === true });
  if (options.json) {
    printJson(result);
  } else {
    console.log(`${result.ok ? 'OK' : 'FAILED'} ${filePath}`);
    console.log(`hash: ${result.hash}`);
    console.log(`size: ${result.size}`);
    for (const finding of result.errors) console.log(`error ${formatFinding(finding)}`);
    for (const finding of result.warnings) console.log(`warning ${formatFinding(finding)}`);
  }
  if (!result.ok) process.exitCode = 1;
}

export async function artifactStatusCommand(file: string, options: JsonOption = {}, deps: ArtifactCommandDeps = {}): Promise<void> {
  const filePath = resolvePath(file, deps.cwd);
  const repository = deps.repository ?? new ArtifactIndexRepository();
  try {
    const result = await getArtifactStatus(filePath, { repository, validate: false });
    if (!result.artifact) {
      if (options.json) printJson({ error: `No artifact exists for ${filePath}`, ...result });
      else {
        console.error(`No artifact exists for ${filePath}`);
        console.log(`currentHash: ${result.currentHash}`);
        console.log(`pendingChanges: ${result.pendingChanges}`);
      }
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      printJson(result);
      return;
    }

    console.log(`filePath: ${result.filePath}`);
    console.log(`slug: ${result.artifact.slug}`);
    console.log(`status: ${repository.getByFilePath(filePath)?.status ?? 'unknown'}`);
    console.log(`currentHash: ${result.currentHash}`);
    console.log(`lastPublishedHash: ${result.lastPublishedHash ?? 'null'}`);
    console.log(`pendingChanges: ${String(result.pendingChanges)}`);
  } finally {
    if (!deps.repository) repository.close();
  }
}

export function artifactListCommand(options: ListOptions = {}, deps: ArtifactCommandDeps = {}): void {
  const repository = deps.repository ?? new ArtifactIndexRepository();
  try {
    const result = listArtifacts({ repository, workspaceId: options.workspace });
    if (options.json) {
      printJson(result);
      return;
    }

    if (result.artifacts.length === 0) {
      console.log('No artifacts found.');
      return;
    }

    for (const entry of result.artifacts) {
      const title = entry.artifact.title ? ` ${entry.artifact.title}` : '';
      const provenance = [entry.artifact.issueId, entry.artifact.workspaceId, entry.artifact.agentRole]
        .filter((value): value is string => Boolean(value))
        .join(' ');
      console.log(`${entry.artifact.slug} ${entry.status}${entry.pendingChanges ? ' pendingChanges' : ''}${title}`);
      if (provenance) console.log(`  ${provenance}`);
      console.log(`  ${entry.urls.wrapperUrl}`);
    }
  } finally {
    if (!deps.repository) repository.close();
  }
}

export function artifactUrlCommand(file: string, options: JsonOption = {}, deps: ArtifactCommandDeps = {}): string | null {
  const resolved = resolveKnownArtifactUrl(file, options, deps);
  if (!resolved) return null;
  if (options.json) printJson({ artifact: resolved.artifact, urls: resolved.urls });
  else console.log(resolved.urls.wrapperUrl);
  return resolved.urls.wrapperUrl;
}

export async function artifactOpenCommand(file: string, options: JsonOption = {}, deps: ArtifactCommandDeps = {}): Promise<void> {
  const resolved = resolveKnownArtifactUrl(file, options, deps);
  if (!resolved) return;
  await (deps.opener ?? openUrlDetached)(resolved.urls.wrapperUrl);
  if (options.json) printJson({ opened: true, url: resolved.urls.wrapperUrl });
  else console.log(`Opened ${resolved.urls.wrapperUrl}`);
}

export function registerArtifactCommands(program: Command): void {
  const artifacts = program
    .command('artifacts')
    .description('Create, publish, validate, inspect, and open shared HTML artifacts');

  artifacts
    .command('create <file>')
    .description('Validate and publish an HTML artifact')
    .option('--issue <id>', 'Issue ID for artifact provenance')
    .option('--workspace <id>', 'Workspace ID for artifact provenance')
    .option('--agent-role <role>', 'Agent role: plan, work, review, test, ship, flywheel, or user')
    .option('--agent-harness <harness>', 'Agent harness: claude-code, pi, codex, or user')
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

  artifacts
    .command('validate <file>')
    .description('Validate an artifact HTML file')
    .option('--strict', 'Enable strict warnings')
    .option('--json', 'Output validation result as JSON')
    .action(artifactValidateCommand);

  artifacts
    .command('status <file>')
    .description('Show artifact hash and publication status for a file')
    .option('--json', 'Output status as JSON')
    .action(artifactStatusCommand);

  artifacts
    .command('list')
    .description('List artifacts')
    .option('--workspace <id>', 'Filter artifacts by workspace ID')
    .option('--json', 'Output artifacts as JSON')
    .action(artifactListCommand);

  artifacts
    .command('url <file>')
    .description('Print the wrapper URL for an artifact file')
    .option('--json', 'Output URL metadata as JSON')
    .action((file, options) => {
      artifactUrlCommand(file, options);
    });

  artifacts
    .command('open <file>')
    .description('Open the wrapper URL for an artifact file')
    .option('--json', 'Output opened URL as JSON')
    .action(artifactOpenCommand);
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
  if (value === 'claude-code' || value === 'pi' || value === 'codex' || value === 'user') return value;
  throw new Error(`Invalid --agent-harness: ${value}`);
}

function resolveKnownArtifactUrl(file: string, options: JsonOption, deps: ArtifactCommandDeps): {
  artifact: ArtifactMetadata;
  urls: ArtifactUrls;
} | null {
  const filePath = resolvePath(file, deps.cwd);
  const repository = deps.repository ?? new ArtifactIndexRepository();
  try {
    const entry = repository.getByFilePath(filePath);
    if (!entry) {
      if (options.json) printJson({ error: `No artifact exists for ${filePath}`, filePath });
      else console.error(`No artifact exists for ${filePath}`);
      process.exitCode = 1;
      return null;
    }
    return { artifact: entry.artifact, urls: resolveArtifactUrl(entry.artifact.slug) };
  } finally {
    if (!deps.repository) repository.close();
  }
}

function resolvePath(file: string, cwd = process.cwd()): string {
  return resolve(cwd, file);
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

function formatFinding(finding: { code: string; message: string; line?: number; column?: number; rule?: string }): string {
  const location = finding.line && finding.column ? `:${finding.line}:${finding.column}` : '';
  const rule = finding.rule ? ` [${finding.rule}]` : '';
  return `${finding.code}${location}${rule}: ${finding.message}`;
}

function openUrlDetached(url: string): void {
  const [command, args] = openerCommand(url);
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function openerCommand(url: string): [string, string[]] {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}
