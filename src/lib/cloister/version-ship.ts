import { relative, resolve, sep } from 'node:path';
import type { VersionSyncConfig } from '../projects.js';

export interface ShipPathResult {
  path: string;
  ok: boolean;
  detail: string;
}

export interface ShipReport {
  status: 'passed' | 'partial' | 'failed';
  version: string;
  batch: string;
  paths: ShipPathResult[];
  error?: string;
  at: string;
}

export interface VersionShipDeps {
  now: () => string;
  writeVersion: (path: string, jsonField: string, version: string) => Promise<void>;
  runCommand: (command: string, cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readFile: (path: string) => Promise<string>;
  hasChanges: (repoRoot: string, paths: string[]) => Promise<boolean>;
  commit: (repoRoot: string, paths: string[], message: string) => Promise<void>;
  push: (repoRoot: string) => Promise<void>;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function failedReport(
  version: string,
  batch: string,
  at: string,
  error: string,
  paths: ShipPathResult[] = [],
): ShipReport {
  return { status: 'failed', version, batch, paths, error, at };
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

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > 2_000 ? trimmed.slice(-2_000) : trimmed;
}

function pathWithinRepo(projectRoot: string, repoRoot: string, declaredPath: string): string | null {
  const absolutePath = resolve(projectRoot, declaredPath);
  const repoRelativePath = relative(repoRoot, absolutePath);
  if (repoRelativePath === '') return null;
  if (repoRelativePath === '..' || repoRelativePath.startsWith(`..${sep}`)) return null;
  return repoRelativePath;
}

function declaredPathsForRepo(projectRoot: string, repoRoot: string, config: VersionSyncConfig): string[] {
  const declared = [
    ...(config.set ?? []).map(entry => entry.path),
    ...(config.expect ?? []).map(entry => entry.path),
  ];
  return [...new Set(declared
    .map(path => pathWithinRepo(projectRoot, repoRoot, path))
    .filter((path): path is string => path !== null))];
}

export async function runVersionShip(
  args: {
    projectRoot: string;
    config: VersionSyncConfig;
    version: string;
    batchName: string;
  },
  deps: VersionShipDeps,
): Promise<ShipReport> {
  const { projectRoot, config, version, batchName } = args;
  const at = deps.now();
  const paths: ShipPathResult[] = [];

  if (!VERSION_PATTERN.test(version)) {
    return failedReport(version, batchName, at, `invalid version "${version}"; expected X.Y.Z`);
  }

  try {
    for (const target of config.set ?? []) {
      await deps.writeVersion(resolve(projectRoot, target.path), target.json_field, version);
    }

    if (config.command) {
      const commandResult = await deps.runCommand(
        config.command,
        resolve(projectRoot, config.command_cwd ?? '.'),
      );
      if (commandResult.exitCode !== 0) {
        const detail = stderrTail(commandResult.stderr) || `command exited ${commandResult.exitCode}`;
        return failedReport(version, batchName, at, detail);
      }
    }

    for (const expectation of config.expect ?? []) {
      const absolutePath = resolve(projectRoot, expectation.path);
      const content = await deps.readFile(absolutePath);
      const pattern = expandPlaceholders(expectation.pattern, version);
      const ok = new RegExp(pattern).test(content);
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

    for (const repoPath of config.push ?? []) {
      const repoRoot = resolve(projectRoot, repoPath);
      const declaredPaths = declaredPathsForRepo(projectRoot, repoRoot, config);
      if (declaredPaths.length > 0 && await deps.hasChanges(repoRoot, declaredPaths)) {
        await deps.commit(repoRoot, declaredPaths, commitMessage);
      }
      await deps.push(repoRoot);
    }

    return { status, version, batch: batchName, paths, at };
  } catch (error) {
    return failedReport(
      version,
      batchName,
      at,
      error instanceof Error ? error.message : String(error),
      paths,
    );
  }
}
