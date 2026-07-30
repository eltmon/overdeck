import { exitCli } from '../exit.js';
import { Command } from 'commander';
import chalk from 'chalk';
import { execFileSync, execSync, spawn } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from 'fs';
import { readdir, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { resolveBunBinary } from '../../lib/deploy/build-from-origin.js';

type ReleaseChannel = 'stable' | 'canary';

type PackageJson = {
  version: string;
  name?: string;
  [key: string]: unknown;
};

type PreflightResult = {
  name: string;
  ok: boolean;
  detail: string;
};

type ReleaseNotesOptions = {
  write?: string;
};

export function resolveReleaseManifestPaths(repoRoot: string) {
  return {
    core: join(repoRoot, 'package.json'),
    desktop: join(repoRoot, 'apps', 'desktop', 'package.json'),
    contracts: join(repoRoot, 'packages', 'contracts', 'package.json'),
  };
}

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
    .option('--version <version>', 'Stable semver version (x.y.z)')
    .option('--skip-tests', 'Skip the test suite in preflight (build + guards still run)')
    .action((options: { version?: string; skipTests?: boolean }) =>
      releaseCreateCommand('stable', options.version, { skipTests: options.skipTests })
    );

  release
    .command('canary')
    .description('Create a canary release commit and tag')
    .option('--version <version>', 'Canary semver version (x.y.z-canary.n)')
    .option('--skip-tests', 'Skip the test suite in preflight (build + guards still run)')
    .action((options: { version?: string; skipTests?: boolean }) =>
      releaseCreateCommand('canary', options.version, { skipTests: options.skipTests })
    );

  release
    .command('sourcemaps')
    .description('Upload the built dashboard sourcemaps to PostHog')
    .requiredOption('--version <version>', 'Release version associated with the built dashboard')
    .action(async (options: { version: string }) => {
      await uploadReleaseSourcemaps(getRepoRoot(), options.version);
    });

  release
    .command('notes [from] [to]')
    .description('Draft release notes from git history')
    .option('--write <path>', 'Write the generated notes to a file')
    .action((from: string | undefined, to: string | undefined, options: ReleaseNotesOptions) =>
      releaseNotesCommand(from, to, options)
    );
}

function readPackageJson(repoRoot: string): PackageJson {
  return JSON.parse(readFileSync(resolveReleaseManifestPaths(repoRoot).core, 'utf-8')) as PackageJson;
}

function writePackageJson(repoRoot: string, pkg: PackageJson): void {
  writeFileSync(resolveReleaseManifestPaths(repoRoot).core, `${JSON.stringify(pkg, null, 2)}\n`);
}

function readDesktopPackageJson(repoRoot: string): PackageJson {
  return JSON.parse(readFileSync(resolveReleaseManifestPaths(repoRoot).desktop, 'utf-8')) as PackageJson;
}

function writeDesktopPackageJson(repoRoot: string, pkg: PackageJson): void {
  writeFileSync(resolveReleaseManifestPaths(repoRoot).desktop, `${JSON.stringify(pkg, null, 2)}\n`);
}

function readContractsPackageJson(repoRoot: string): PackageJson {
  return JSON.parse(readFileSync(resolveReleaseManifestPaths(repoRoot).contracts, 'utf-8')) as PackageJson;
}

function writeContractsPackageJson(repoRoot: string, pkg: PackageJson): void {
  writeFileSync(resolveReleaseManifestPaths(repoRoot).contracts, `${JSON.stringify(pkg, null, 2)}\n`);
}

function getCurrentVersion(repoRoot: string): string {
  return readPackageJson(repoRoot).version;
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

type SourcemapCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<void>;

function runSourcemapCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`));
    });
  });
}

async function removeSourcemaps(directory: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeSourcemaps(path);
    else if (entry.isFile() && entry.name.endsWith('.map')) await unlink(path);
  }));
}

export async function uploadReleaseSourcemaps(
  repoRoot: string,
  version: string,
  options: {
    env?: NodeJS.ProcessEnv;
    run?: SourcemapCommandRunner;
    warn?: (message: string) => void;
  } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? console.warn;
  const directory = join(repoRoot, 'dist', 'dashboard', 'public');
  if (!env.POSTHOG_CLI_API_KEY) {
    warn('Warning: POSTHOG_CLI_API_KEY is not set; skipping PostHog sourcemap upload.');
    await removeSourcemaps(directory);
    return;
  }

  const runCommand = options.run ?? runSourcemapCommand;
  const releaseArgs = [
    '--directory', directory,
    '--release-name', 'overdeck-dashboard',
    '--release-version', version,
  ];

  try {
    await runCommand('npx', ['--no-install', 'posthog-cli', 'sourcemap', 'inject', ...releaseArgs], {
      cwd: repoRoot,
      env,
    });
    await runCommand('npx', [
      '--no-install',
      'posthog-cli',
      'sourcemap',
      'upload',
      ...releaseArgs,
      '--delete-after',
    ], { cwd: repoRoot, env });
  } finally {
    await removeSourcemaps(directory);
  }
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

function getRemoteStateBranchSha(repoRoot: string): string | undefined {
  try {
    const output = run('git ls-remote --heads origin refs/heads/overdeck-state', repoRoot);
    const sha = output.split(/\s+/)[0];
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

function getCommitSubjects(repoRoot: string, range: string): string[] {
  try {
    const output = run(`git log ${range} --pretty=format:%s`, repoRoot);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    throw new Error(`Could not generate release notes for range: ${range}`);
  }
}

/** Commit subjects that are pure pipeline bookkeeping — never user-facing. */
const RELEASE_NOTE_NOISE: RegExp[] = [
  /^chore\((records|state|beads|tasks)\)/,
  /^chore: (reconcile|integrate)/,
  /^chore\(state\): update spec/,
  /^docs: run-\d+/,
  /^Merge /,
  /per-issue record$/,
];

function isReleaseNoteNoise(subject: string): boolean {
  return RELEASE_NOTE_NOISE.some((re) => re.test(subject));
}

/** Strip a conventional-commit `type(scope):` prefix and capitalize for readability. */
function humanizeSubject(subject: string): string {
  const match = subject.match(/^\w+(\([^)]*\))?!?:\s*(.*)$/);
  const body = match ? match[2] : subject;
  return body.length > 0 ? body[0].toUpperCase() + body.slice(1) : body;
}

/**
 * Turn a flat list of commit subjects into grouped, de-noised release
 * highlights: Features / Fixes / Performance, with everything else collapsed
 * into a single "internal changes" count. Drops bookkeeping commits entirely so
 * the changelog reads for a human, not a git log.
 */
export function groupCommitSubjects(entries: string[]): string {
  const features: string[] = [];
  const fixes: string[] = [];
  const perf: string[] = [];
  let internal = 0;
  const seen = new Set<string>();

  for (const subject of entries) {
    if (isReleaseNoteNoise(subject)) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (/^(feat|Add )/.test(subject)) features.push(humanizeSubject(subject));
    else if (/^(fix|Fix )/.test(subject)) fixes.push(humanizeSubject(subject));
    else if (/^perf/.test(subject)) perf.push(humanizeSubject(subject));
    else internal += 1;
  }

  const sections: string[] = [];
  const addSection = (title: string, items: string[]) => {
    if (items.length > 0) sections.push(`### ${title}\n${items.map((i) => `- ${i}`).join('\n')}`);
  };
  addSection('Features', features);
  addSection('Fixes', fixes);
  addSection('Performance', perf);
  if (internal > 0) {
    sections.push(`_Plus ${internal} internal change${internal === 1 ? '' : 's'} (refactors, tests, tooling)._`);
  }

  return sections.length > 0 ? sections.join('\n\n') : '- No user-facing changes in the selected range.';
}

export function buildReleaseNotesMarkdown(params: {
  channel: ReleaseChannel;
  version: string;
  from: string | null;
  to: string;
  entries: string[];
  packageName: string;
  stateBranchSha?: string;
}): string {
  const { channel, version, from, to, entries, packageName, stateBranchSha } = params;
  const range = from ? `${from}...${to}` : to;
  // Pin the package name (passed in from package.json) and the exact version, so a release's
  // notes install THAT release. The package was renamed across history
  // (panopticon-cli -> @panctl/cli -> @overdeck/core); never hardcode it here.
  const installCommand = `npm install -g ${packageName}@${version}`;

  const highlights = groupCommitSubjects(entries);

  return `## Summary
- Release ${version} (${channel})
- Built from ${range}
- Published intentionally from main via tag promotion
${stateBranchSha ? `- State snapshot: overdeck-state ${stateBranchSha}\n` : ''}

## Highlights
${highlights}

## Breaking changes
- None explicitly called out in commit subjects. Review the full changelog before upgrading across versions.

## Install
\`\`\`bash
${installCommand}
\`\`\`

## Full changelog
${from ? `- https://github.com/eltmon/overdeck/compare/${from}...${to}` : '- First tagged release in this range'}
`;
}

function writeTextFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content);
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

function inferNextVersion(channel: ReleaseChannel, currentVersion: string): string {
  if (channel === 'stable') {
    const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-canary\.\d+)?$/);
    if (!match) {
      throw new Error(`Cannot infer next stable version from current version: ${currentVersion}`);
    }

    const [, major, minor, patch] = match;
    return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
  }

  const canaryMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)-canary\.(\d+)$/);
  if (canaryMatch) {
    const [, major, minor, patch, canary] = canaryMatch;
    return `${major}.${minor}.${patch}-canary.${Number.parseInt(canary, 10) + 1}`;
  }

  const stableMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!stableMatch) {
    throw new Error(`Cannot infer next canary version from current version: ${currentVersion}`);
  }

  const [, major, minor, patch] = stableMatch;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}-canary.1`;
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

function runPreflight(repoRoot: string, opts: { skipTests?: boolean } = {}): PreflightResult[] {
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

  // The CI guardrail refuses to advance main when legacy planning paths are
  // still tracked. Mirror that here so we catch leaks BEFORE tagging, not
  // after the release workflow fails.
  //
  // PAN-967 retired the `.planning/` directory in favour of tracked planning artifacts
  // (proposed, active, completed, cancelled). Only `.planning/` is legacy;
  // Legacy `vbrief/` lifecycle archives are tracked intentionally — listing
  // it here used to false-flag every release with "233 file(s) tracked".
  const trackedLegacyPlanning = (() => {
    try {
      return execFileSync('git', ['ls-files', '--', '.planning/'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim();
    } catch {
      return '';
    }
  })();
  results.push({
    name: 'No legacy planning tracked',
    ok: trackedLegacyPlanning === '',
    detail: trackedLegacyPlanning === ''
      ? 'clean'
      : `${trackedLegacyPlanning.split('\n').length} file(s) tracked — strip before tagging`,
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

  if (opts.skipTests) {
    results.push({
      name: 'Tests',
      ok: true,
      detail: 'skipped (--skip-tests)',
    });
  } else {
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
  const currentVersion = getCurrentVersion(repoRoot);
  const latestTag = getLatestTag(repoRoot);

  console.log(chalk.bold('Overdeck Release Check\n'));
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
    return exitCli(1);
  }
}

async function releaseCreateCommand(
  channel: ReleaseChannel,
  version?: string,
  opts: { skipTests?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRoot();
  const currentVersion = getCurrentVersion(repoRoot);
  const previousTag = getLatestTag(repoRoot);
  const resolvedVersion = version ?? inferNextVersion(channel, currentVersion);
  const pkg = readPackageJson(repoRoot);
  const tagName = `v${resolvedVersion}`;
  const releaseNotesPath = join(repoRoot, '.release', `${tagName}.md`);

  validateVersion(channel, resolvedVersion);
  ensureMainBranch(repoRoot);
  ensureCleanTree(repoRoot);
  ensureTagDoesNotExist(repoRoot, tagName);

  console.log(chalk.bold(`Overdeck ${channel === 'stable' ? 'Stable' : 'Canary'} Release\n`));
  console.log(`Current version: ${chalk.cyan(currentVersion)}`);
  console.log(`Target version:  ${chalk.cyan(resolvedVersion)}`);
  if (!version) {
    console.log(chalk.dim(`Inferred ${channel} version from current version.`));
  }
  console.log('');

  const results = runPreflight(repoRoot, { skipTests: opts.skipTests });
  for (const result of results) {
    const marker = result.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`${marker} ${result.name}: ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(chalk.red('\nRelease preflight failed.'));
    return exitCli(1);
  }

  // Resolve bun before any file is mutated: the create phase shells out to it
  // for the lockfile refresh, and a missing binary after the bumps strands a
  // half-applied release that then trips ensureCleanTree on the retry.
  const bunBinary = await resolveBunBinary(repoRoot);

  let committed = false;
  try {
    pkg.version = resolvedVersion;
    writePackageJson(repoRoot, pkg);

    const desktopPkg = readDesktopPackageJson(repoRoot);
    desktopPkg.version = resolvedVersion;
    writeDesktopPackageJson(repoRoot, desktopPkg);

    const contractsPkg = readContractsPackageJson(repoRoot);
    contractsPkg.version = resolvedVersion;
    writeContractsPackageJson(repoRoot, contractsPkg);

    const entries = getCommitSubjects(repoRoot, previousTag ? `${previousTag}..HEAD` : 'HEAD');
    const releaseNotes = buildReleaseNotesMarkdown({
      channel,
      version: resolvedVersion,
      from: previousTag,
      to: tagName,
      entries,
      packageName: pkg.name ?? '@overdeck/core',
      stateBranchSha: channel === 'stable' ? getRemoteStateBranchSha(repoRoot) : undefined,
    });

    writeTextFile(releaseNotesPath, releaseNotes);

    execFileSync(bunBinary, ['install'], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] });

    run(
      `git add package.json apps/desktop/package.json packages/contracts/package.json bun.lock ${releaseNotesPath}`,
      repoRoot
    );
    // Idempotent: when retagging the same version after a CI failure, the package
    // bumps and release notes are already on HEAD. Skip the commit if nothing
    // staged. Tagging is still meaningful because the tag may have been deleted.
    const hasStagedChanges = (() => {
      try {
        execSync('git diff --cached --quiet', { cwd: repoRoot });
        return false;
      } catch {
        return true;
      }
    })();
    if (hasStagedChanges) {
      run(`git commit -m "chore: release ${resolvedVersion}"`, repoRoot);
    } else {
      console.log(chalk.dim('No version-bump changes to commit — tagging current HEAD.'));
    }
    committed = true;
    run(`git tag -a ${tagName} -m "Release ${resolvedVersion}"`, repoRoot);
  } catch (error) {
    // Before the release commit exists, the bumps and notes file are this
    // command's own uncommitted writes — roll them back so a retry starts from
    // a clean tree instead of failing ensureCleanTree. After the commit they
    // are history and must stay.
    if (!committed) {
      try {
        run('git restore --source=HEAD --staged --worktree package.json apps/desktop/package.json packages/contracts/package.json bun.lock', repoRoot);
      } catch {
        // The restore is best-effort; the original error matters more.
      }
      rmSync(releaseNotesPath, { force: true });
      console.error(chalk.red('Release creation failed — rolled back the version bumps and release notes.'));
    }
    throw error;
  }

  console.log(chalk.green('\n✓ Release commit and tag created'));
  console.log(`Commit: ${chalk.cyan(run('git rev-parse --short HEAD', repoRoot))}`);
  console.log(`Tag:    ${chalk.cyan(tagName)}`);
  console.log('');
  console.log(chalk.bold('Next steps:'));
  console.log(`  ${chalk.dim('git push origin main')}`);
  console.log(`  ${chalk.dim(`git push origin ${tagName}`)}`);
  console.log('');
  console.log(`Release notes: ${chalk.cyan(releaseNotesPath)}`);
  console.log(chalk.dim(`The GitHub release workflow will publish ${channel === 'stable' ? 'latest' : 'canary'} when the tag is pushed.`));
}

async function releaseNotesCommand(
  from?: string,
  to?: string,
  options: ReleaseNotesOptions = {}
): Promise<void> {
  const repoRoot = getRepoRoot();
  const resolvedTo = to ?? 'HEAD';
  const resolvedFrom = from ?? getLatestTag(repoRoot);

  let range = resolvedTo;
  if (resolvedFrom) {
    range = `${resolvedFrom}..${resolvedTo}`;
  }

  const entries = getCommitSubjects(repoRoot, range);
  const markdown = buildReleaseNotesMarkdown({
    channel: resolvedTo.includes('canary') ? 'canary' : 'stable',
    version: resolvedTo.replace(/^v/, ''),
    from: resolvedFrom,
    to: resolvedTo,
    entries,
    packageName: readPackageJson(repoRoot).name ?? '@overdeck/core',
  });

  if (options.write) {
    const filePath = join(repoRoot, options.write);
    writeTextFile(filePath, markdown);
    console.log(chalk.green(`Wrote release notes to ${filePath}`));
    return;
  }

  console.log(markdown);
}
