import { relative, resolve, sep } from 'node:path';
import type { VersionSyncConfig } from '../projects.js';

export interface ShipPathResult {
  path: string;
  ok: boolean;
  detail: string;
}

export type ShipFailureCode =
  | 'invalid-version'
  | 'path-validation-failed'
  | 'command-failed'
  | 'expectation-failed'
  | 'commit-failed'
  | 'push-failed'
  | 'workspace-failed'
  | 'unexpected-failure';

export interface ShipReport {
  status: 'passed' | 'partial' | 'failed';
  version: string;
  batch: string;
  paths: ShipPathResult[];
  errorCode?: ShipFailureCode;
  /** Redacted, operator-safe summary. Never raw command or Git output. */
  error?: string;
  at: string;
}

export interface VersionShipAllowedRepo {
  /** Path relative to the prepared project root; `.` for a monorepo. */
  path: string;
  /** Explicit remote target ref for `git push origin HEAD:<targetBranch>`. */
  targetBranch: string;
  /** Prepared worktree HEAD before any version mutation. */
  expectedHead: string;
  /** Canonical Git directory owned by the prepared linked worktree. */
  expectedGitDir: string;
}

export class VersionShipOperationError extends Error {
  constructor(
    readonly code: Exclude<ShipFailureCode, 'invalid-version' | 'command-failed' | 'expectation-failed' | 'unexpected-failure'>,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'VersionShipOperationError';
  }
}

export interface VersionShipDeps {
  now: () => string;
  resolveFile: (projectRoot: string, declaredPath: string) => Promise<string>;
  resolveDirectory: (projectRoot: string, declaredPath: string) => Promise<string>;
  writeVersion: (path: string, jsonField: string, version: string) => Promise<void>;
  runCommand: (
    command: string,
    cwd: string,
    projectRoot: string,
    image: string,
    copyBackPaths: string[],
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readFile: (path: string) => Promise<string>;
  replaceVersionCapture: (
    pattern: string,
    content: string,
    replacement: string,
  ) => Promise<{ content: string; replacements: number }>;
  testPattern: (pattern: string, content: string) => Promise<boolean>;
  verifyRepo: (
    repoRoot: string,
    expectedHead: string,
    expectedGitDir: string,
    allowHeadDescendant: boolean,
  ) => Promise<void>;
  hasChanges: (repoRoot: string, paths: string[]) => Promise<boolean>;
  commit: (repoRoot: string, paths: string[], message: string) => Promise<void>;
  push: (repoRoot: string, targetBranch: string) => Promise<void>;
  /** Local-only diagnostic sink. Implementations must redact credentials. */
  logDiagnostic?: (message: string) => void;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function failedReport(
  version: string,
  batch: string,
  at: string,
  errorCode: ShipFailureCode,
  error: string,
  paths: ShipPathResult[] = [],
): ShipReport {
  return { status: 'failed', version, batch, paths, errorCode, error, at };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandPlaceholders(value: string, version: string): string {
  const majorMinor = version.split('.').slice(0, 2).join('.');
  return value
    .replaceAll('{version}', escapeRegex(version))
    .replaceAll('{majorMinor}', escapeRegex(majorMinor));
}

function expandMessage(value: string, version: string): string {
  const majorMinor = version.split('.').slice(0, 2).join('.');
  return value
    .replaceAll('{version}', version)
    .replaceAll('{majorMinor}', majorMinor);
}

function normalizedRelativePath(projectRoot: string, declaredPath: string): string {
  const rel = relative(projectRoot, resolve(projectRoot, declaredPath));
  return rel === '' ? '.' : rel;
}

function pathsWithinRepo(repoRoot: string, absolutePaths: readonly string[]): string[] {
  return [...new Set(absolutePaths.flatMap(absolutePath => {
    const repoRelativePath = relative(repoRoot, absolutePath);
    if (repoRelativePath === '' || repoRelativePath === '..' || repoRelativePath.startsWith(`..${sep}`)) return [];
    return [repoRelativePath];
  }))];
}

function operationFailure(error: unknown): { code: ShipFailureCode; message: string } {
  if (error instanceof VersionShipOperationError) {
    return { code: error.code, message: error.safeMessage };
  }
  return { code: 'unexpected-failure', message: 'version ship failed unexpectedly; inspect the local dashboard log' };
}

export async function runVersionShip(
  args: {
    projectRoot: string;
    config: VersionSyncConfig;
    version: string;
    batchName: string;
    allowedRepos: readonly VersionShipAllowedRepo[];
  },
  deps: VersionShipDeps,
): Promise<ShipReport> {
  const { projectRoot, config, version, batchName } = args;
  const at = deps.now();
  const paths: ShipPathResult[] = [];

  if (!VERSION_PATTERN.test(version)) {
    return failedReport(version, batchName, at, 'invalid-version', 'version must look like 48.8.0');
  }
  if (!config.expect?.length) {
    return failedReport(
      version,
      batchName,
      at,
      'path-validation-failed',
      'version_sync.expect must contain at least one entry',
    );
  }
  if (!config.push?.length) {
    return failedReport(
      version,
      batchName,
      at,
      'path-validation-failed',
      'version_sync.push must contain at least one repository',
    );
  }
  if (config.replace?.length && !config.command) {
    return failedReport(
      version,
      batchName,
      at,
      'path-validation-failed',
      'version_sync.command is required when version_sync.replace is set',
    );
  }
  const invalidReplacement = config.replace?.find(replacement => (
    (replacement.pattern.match(/\(\?<version>/g) ?? []).length !== 1
    || (replacement.value !== '{version}' && replacement.value !== '{majorMinor}')
  ));
  if (invalidReplacement) {
    return failedReport(
      version,
      batchName,
      at,
      'path-validation-failed',
      `version_sync.replace must declare one named version capture and an allowed value: ${invalidReplacement.path}`,
    );
  }

  try {
    // Resolve and validate every configured path before the first mutation. The
    // real deps reject symlink components and paths outside the prepared tree.
    const setTargets = await Promise.all((config.set ?? []).map(async target => ({
      ...target,
      absolutePath: await deps.resolveFile(projectRoot, target.path),
    })));
    const replacements = await Promise.all((config.replace ?? []).map(async replacement => ({
      ...replacement,
      absolutePath: await deps.resolveFile(projectRoot, replacement.path),
    })));
    const expectations = await Promise.all((config.expect ?? []).map(async expectation => ({
      ...expectation,
      absolutePath: await deps.resolveFile(projectRoot, expectation.path),
    })));
    if (config.command && !config.command_image) {
      throw new VersionShipOperationError(
        'path-validation-failed',
        'version_sync.command_image is required to sandbox the version sync command',
      );
    }
    const commandCwd = config.command
      ? await deps.resolveDirectory(projectRoot, config.command_cwd ?? '.')
      : null;

    const allowedByPath = new Map(args.allowedRepos.map(repo => [
      normalizedRelativePath(projectRoot, repo.path),
      repo,
    ]));
    const pushTargets = await Promise.all((config.push ?? []).map(async declaredPath => {
      const normalized = normalizedRelativePath(projectRoot, declaredPath);
      const allowed = allowedByPath.get(normalized);
      if (!allowed) {
        throw new VersionShipOperationError(
          'path-validation-failed',
          `version_sync.push path is not a registered project repository: ${declaredPath}`,
        );
      }
      const repoRoot = await deps.resolveDirectory(projectRoot, declaredPath);
      return {
        declaredPath,
        repoRoot,
        targetBranch: allowed.targetBranch,
        expectedHead: allowed.expectedHead,
        expectedGitDir: allowed.expectedGitDir,
      };
    }));
    for (const output of [...setTargets, ...replacements, ...expectations]) {
      const owners = pushTargets.filter(target => {
        const repoRelativePath = relative(target.repoRoot, output.absolutePath);
        return repoRelativePath !== ''
          && repoRelativePath !== '..'
          && !repoRelativePath.startsWith(`..${sep}`);
      });
      if (owners.length !== 1) {
        throw new VersionShipOperationError(
          'path-validation-failed',
          owners.length === 0
            ? `version_sync output is not covered by a push repository: ${output.path}`
            : `version_sync output is covered by multiple push repositories: ${output.path}`,
        );
      }
    }

    const structuredTargetPaths = new Set(setTargets.map(target => target.absolutePath));
    const overlappingReplacement = replacements.find(replacement => structuredTargetPaths.has(replacement.absolutePath));
    if (overlappingReplacement) {
      throw new VersionShipOperationError(
        'path-validation-failed',
        `version_sync path cannot be both set and replace: ${overlappingReplacement.path}`,
      );
    }

    for (const target of setTargets) {
      await deps.writeVersion(target.absolutePath, target.json_field, version);
    }

    if (config.command && commandCwd && config.command_image) {
      const commandPaths = [...new Set([
        ...setTargets.map(target => target.path),
        ...replacements.map(replacement => replacement.path),
      ])];
      const expectedContents = new Map<string, string>();
      for (const declaredPath of commandPaths) {
        const absolutePath = await deps.resolveFile(projectRoot, declaredPath);
        expectedContents.set(declaredPath, await deps.readFile(absolutePath));
      }
      for (const replacement of replacements) {
        const current = expectedContents.get(replacement.path)!;
        const transformed = await deps.replaceVersionCapture(
          replacement.pattern,
          current,
          expandMessage(replacement.value, version),
        );
        if (transformed.replacements === 0) {
          throw new VersionShipOperationError(
            'path-validation-failed',
            `version_sync.replace pattern did not match a version capture: ${replacement.path}`,
          );
        }
        expectedContents.set(replacement.path, transformed.content);
      }

      const commandResult = await deps.runCommand(
        config.command,
        commandCwd,
        projectRoot,
        config.command_image,
        commandPaths,
      );
      if (commandResult.exitCode !== 0) {
        deps.logDiagnostic?.(
          `[version-ship] command exited ${commandResult.exitCode}: ${commandResult.stderr || commandResult.stdout}`,
        );
        return failedReport(
          version,
          batchName,
          at,
          'command-failed',
          `version sync command failed (exit ${commandResult.exitCode}); inspect the local dashboard log`,
        );
      }

      for (const declaredPath of commandPaths) {
        const absolutePath = await deps.resolveFile(projectRoot, declaredPath);
        const actual = await deps.readFile(absolutePath);
        if (actual !== expectedContents.get(declaredPath)) {
          deps.logDiagnostic?.(`[version-ship] command changed content outside declared captures in ${declaredPath}`);
          return failedReport(
            version,
            batchName,
            at,
            'command-failed',
            `version sync command changed content outside declared captures: ${declaredPath}`,
          );
        }
      }
    }

    for (const expectation of expectations) {
      const postCommandPath = await deps.resolveFile(projectRoot, expectation.path);
      const content = await deps.readFile(postCommandPath);
      const pattern = expandPlaceholders(expectation.pattern, version);
      const ok = await deps.testPattern(pattern, content);
      paths.push({
        path: expectation.path,
        ok,
        detail: ok ? `reports ${version}` : `pattern did not match ${version}`,
      });
    }

    const status: ShipReport['status'] = paths.some(path => !path.ok) ? 'partial' : 'passed';
    const commitMessage = expandMessage(
      config.commit_message ?? 'chore: bump version to {version}',
      version,
    );
    const declaredAbsolutePaths = await Promise.all([
      ...setTargets.map(target => deps.resolveFile(projectRoot, target.path)),
      ...replacements.map(replacement => deps.resolveFile(projectRoot, replacement.path)),
      ...expectations.map(expectation => deps.resolveFile(projectRoot, expectation.path)),
    ]);

    for (const target of pushTargets) {
      const repoRoot = await deps.resolveDirectory(projectRoot, target.declaredPath);
      const declaredPaths = pathsWithinRepo(repoRoot, declaredAbsolutePaths);
      await deps.verifyRepo(repoRoot, target.expectedHead, target.expectedGitDir, false);
      if (declaredPaths.length > 0 && await deps.hasChanges(repoRoot, declaredPaths)) {
        await deps.verifyRepo(repoRoot, target.expectedHead, target.expectedGitDir, false);
        await deps.commit(repoRoot, declaredPaths, commitMessage);
      }
      await deps.verifyRepo(repoRoot, target.expectedHead, target.expectedGitDir, true);
      await deps.push(repoRoot, target.targetBranch);
    }

    return { status, version, batch: batchName, paths, at };
  } catch (error) {
    deps.logDiagnostic?.(`[version-ship] operation failed: ${error instanceof Error ? error.message : String(error)}`);
    const failure = operationFailure(error);
    return failedReport(version, batchName, at, failure.code, failure.message, paths);
  }
}
