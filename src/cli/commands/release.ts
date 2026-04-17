import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

type ReleaseChannel = 'stable' | 'canary';

type PackageJson = {
  version: string;
  [key: string]: unknown;
};

type PreflightResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', '..', 'package.json');

export function registerReleaseCommands(program: Command): void {
  const release = program
    .command('release')
    .description('Intentional release flow for stable and canary publishes');

  release
    .command('check')
    .description('Run release preflight checks')
    .action(releaseCheckCommand);

  release
    .command('stable')
    .description('Create a stable release commit and tag')
    .requiredOption('--version <version>', 'Stable semver version (x.y.z)')
    .action((options: { version: string }) => releaseCreateCommand('stable', options.version));

  release
    .command('canary')
    .description('Create a canary release commit and tag')
    .requiredOption('--version <version>', 'Canary semver version (x.y.z-canary.n)')
    .action((options: { version: string }) => releaseCreateCommand('canary', options.version));

  release
    .command('notes [from] [to]')
    .description('Draft release notes from git history')
    .action(releaseNotesCommand);
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
}

function writePackageJson(pkg: PackageJson): void {
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function getCurrentVersion(): string {
  return readPackageJson().version;
}

function run(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function runStreaming(command: string, cwd: string): void {
  execSync(command, {
    cwd,
    stdio: 'inherit',
  });
}

function getRepoRoot(): string {
  return run('git rev-parse --show-toplevel', process.cwd());
}

function getCurrentBranch(repoRoot: string): string {
  return run('git rev-parse --abbrev-ref HEAD', repoRoot);
}

function isWorkingTreeClean(repoRoot: string): boolean {
  return run('git status --short', repoRoot) === '';
}

function getLatestTag(repoRoot: string): string | null {
  try {
    return run('git describe --tags --abbrev=0', repoRoot);
  } catch {
    return null;
  }
}

function validateVersion(channel: ReleaseChannel, version: string): void {
  const stablePattern = /^\d+\.\d+\.\d+$/;
  const canaryPattern = /^\d+\.\d+\.\d+-canary\.\d+$/;

  const valid = channel === 'stable'
    ? stablePattern.test(version)
    : canaryPattern.test(version);

  if (!valid) {
    const expected = channel === 'stable' ? 'x.y.z' : 'x.y.z-canary.n';
    throw new Error(`Invalid ${channel} version: ${version}. Expected ${expected}`);
  }
}

function ensureMainBranch(repoRoot: string): void {
  const branch = getCurrentBranch(repoRoot);
  if (branch !== 'main') {
    throw new Error(`Releases must be cut from main. Current branch: ${branch}`);
  }
}

function ensureCleanTree(repoRoot: string): void {
  if (!isWorkingTreeClean(repoRoot)) {
    throw new Error('Working tree must be clean before creating a release');
  }
}

function ensureTagDoesNotExist(repoRoot: string, tagName: string): void {
  try {
    run(`git rev-parse --verify --quiet refs/tags/${tagName}`, repoRoot);
    throw new Error(`Tag already exists: ${tagName}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Tag already exists')) {
      throw error;
    }
  }
}

function runPreflight(repoRoot: string): PreflightResult[] {
  const results: PreflightResult[] = [];

  const branch = getCurrentBranch(repoRoot);
  results.push({
    name: 'Branch',
    ok: branch === 'main',
    detail: branch,
  });

  const clean = isWorkingTreeClean(repoRoot);
  results.push({
    name: 'Working tree',
    ok: clean,
    detail: clean ? 'clean' : 'dirty',
  });

  try {
    runStreaming('npm run build', repoRoot);
    results.push({
      name: 'Build',
      ok: true,
      detail: 'npm run build passed',
    });
  } catch {
    results.push({
      name: 'Build',
      ok: false,
      detail: 'npm run build failed',
    });
  }

  try {
    runStreaming('npm test', repoRoot);
    results.push({
      name: 'Tests',
      ok: true,
      detail: 'npm test passed',
    });
  } catch {
    results.push({
      name: 'Tests',
      ok: false,
      detail: 'npm test failed',
    });
  }

  try {
    runStreaming('node dist/cli/index.js release --help', repoRoot);
    results.push({
      name: 'CLI',
      ok: true,
      detail: 'release help rendered',
    });
  } catch {
    results.push({
      name: 'CLI',
      ok: false,
      detail: 'release help failed',
    });
  }

  return results;
}

async function releaseCheckCommand(): Promise<void> {
  const repoRoot = getRepoRoot();
  const currentVersion = getCurrentVersion();
  const latestTag = getLatestTag(repoRoot);

  console.log(chalk.bold('Panopticon Release Check\n'));
  console.log(`Current version: ${chalk.cyan(currentVersion)}`);
  console.log(`Current branch:  ${chalk.cyan(getCurrentBranch(repoRoot))}`);
  console.log(`Latest tag:      ${chalk.cyan(latestTag ?? 'none')}`);
  console.log('');

  const results = runPreflight(repoRoot);
  for (const result of results) {
    const marker = result.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`${marker} ${result.name}: ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
}

async function releaseCreateCommand(channel: ReleaseChannel, version: string): Promise<void> {
  const repoRoot = getRepoRoot();
  const currentVersion = getCurrentVersion();
  const pkg = readPackageJson();
  const tagName = `v${version}`;

  validateVersion(channel, version);
  ensureMainBranch(repoRoot);
  ensureCleanTree(repoRoot);
  ensureTagDoesNotExist(repoRoot, tagName);

  console.log(chalk.bold(`Panopticon ${channel === 'stable' ? 'Stable' : 'Canary'} Release\n`));
  console.log(`Current version: ${chalk.cyan(currentVersion)}`);
  console.log(`Target version:  ${chalk.cyan(version)}`);
  console.log('');

  const results = runPreflight(repoRoot);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(chalk.red('\nRelease preflight failed.'));
    process.exit(1);
  }

  pkg.version = version;
  writePackageJson(pkg);

  run('git add package.json', repoRoot);
  run(`git commit -m "chore: release ${version}"`, repoRoot);
  run(`git tag -a ${tagName} -m "Release ${version}"`, repoRoot);

  console.log(chalk.green('\n✓ Release commit and tag created'));
  console.log(`Commit: ${chalk.cyan(run('git rev-parse --short HEAD', repoRoot))}`);
  console.log(`Tag:    ${chalk.cyan(tagName)}`);
  console.log('');
  console.log(chalk.bold('Next steps:'));
  console.log(`  ${chalk.dim('git push origin main')}`);
  console.log(`  ${chalk.dim(`git push origin ${tagName}`)}`);
  console.log('');
  console.log(chalk.dim(`The GitHub release workflow will publish ${channel === 'stable' ? 'latest' : 'canary'} when the tag is pushed.`));
}

async function releaseNotesCommand(from?: string, to?: string): Promise<void> {
  const repoRoot = getRepoRoot();
  const resolvedTo = to ?? 'HEAD';
  const resolvedFrom = from ?? getLatestTag(repoRoot);

  let range = resolvedTo;
  if (resolvedFrom) {
    range = `${resolvedFrom}..${resolvedTo}`;
  }

  let logOutput = '';
  try {
    logOutput = run(`git log ${range} --pretty=format:%s`, repoRoot);
  } catch {
    throw new Error(`Could not generate release notes for range: ${range}`);
  }

  const entries = logOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  console.log(chalk.bold('Release Notes\n'));
  console.log(`Range: ${chalk.cyan(resolvedFrom ? `${resolvedFrom}..${resolvedTo}` : resolvedTo)}`);
  console.log('');

  if (entries.length === 0) {
    console.log(chalk.dim('No commits found in the requested range.'));
    return;
  }

  for (const entry of entries) {
    console.log(`- ${entry}`);
  }
}
