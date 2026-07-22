import { chmod, mkdir, readFile, readdir, realpath as fsRealpath, writeFile } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

const MINIMUM_NODE_MAJOR = 24;
const OPEN_KNOWLEDGE_NODE_ENV = 'OVERDECK_OPEN_KNOWLEDGE_NODE';
const OVERDECK_SHIM_MARKER = 'overdeck-managed shim';

export type NodeVersionManager = 'nvm' | 'fnm' | 'volta' | 'mise' | 'asdf';
export type NodeRuntimeSource = 'override' | NodeVersionManager;

export interface NodeRuntimeCommandResult {
  stdout: string;
  stderr: string;
}

export type NodeRuntimeCommandRunner = (
  command: string,
  args: string[],
) => Promise<NodeRuntimeCommandResult>;
export type NodeRuntimeListDir = (directory: string) => Promise<readonly string[]>;

export type Node24RuntimeResolution =
  | { kind: 'runtime'; nodePath: string; source: NodeRuntimeSource }
  | { kind: 'manager-without-24'; manager: NodeVersionManager }
  | { kind: 'none' };

export interface ResolveNode24RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  listDir?: NodeRuntimeListDir;
  realpath?: (path: string) => Promise<string>;
  runCommand: NodeRuntimeCommandRunner;
}

export interface WriteOkShimOptions {
  nodePath: string;
  entryScript: string;
  shimPath?: string;
}

export type OkShimOwnership = 'overdeck' | 'foreign' | 'absent';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

interface ManagerDefinition {
  name: NodeVersionManager;
  envVar: string;
  defaultRoots: (home: string) => string[];
  versionsDirectory: (root: string) => string;
  nodePath: (versionsDirectory: string, versionDirectory: string) => string;
}

interface DetectedManager {
  definition: ManagerDefinition;
  root: string;
}

interface RuntimeCandidate {
  manager: NodeVersionManager;
  nodePath: string;
  version: ParsedVersion;
}

const MANAGERS: readonly ManagerDefinition[] = [
  {
    name: 'nvm',
    envVar: 'NVM_DIR',
    defaultRoots: (home) => [join(home, '.nvm'), join(home, '.config', 'nvm')],
    versionsDirectory: (root) => join(root, 'versions', 'node'),
    nodePath: (versionsDirectory, versionDirectory) => join(versionsDirectory, versionDirectory, 'bin', 'node'),
  },
  {
    name: 'fnm',
    envVar: 'FNM_DIR',
    defaultRoots: (home) => [join(home, '.local', 'share', 'fnm'), join(home, 'Library', 'Application Support', 'fnm')],
    versionsDirectory: (root) => join(root, 'node-versions'),
    nodePath: (versionsDirectory, versionDirectory) =>
      join(versionsDirectory, versionDirectory, 'installation', 'bin', 'node'),
  },
  {
    name: 'volta',
    envVar: 'VOLTA_HOME',
    defaultRoots: (home) => [join(home, '.volta')],
    versionsDirectory: (root) => join(root, 'tools', 'image', 'node'),
    nodePath: (versionsDirectory, versionDirectory) => join(versionsDirectory, versionDirectory, 'bin', 'node'),
  },
  {
    name: 'mise',
    envVar: 'MISE_DATA_DIR',
    defaultRoots: (home) => [join(home, '.local', 'share', 'mise')],
    versionsDirectory: (root) => join(root, 'installs', 'node'),
    nodePath: (versionsDirectory, versionDirectory) => join(versionsDirectory, versionDirectory, 'bin', 'node'),
  },
  {
    name: 'asdf',
    envVar: 'ASDF_DATA_DIR',
    defaultRoots: (home) => [join(home, '.asdf')],
    versionsDirectory: (root) => join(root, 'installs', 'nodejs'),
    nodePath: (versionsDirectory, versionDirectory) => join(versionsDirectory, versionDirectory, 'bin', 'node'),
  },
];

export async function resolveNode24Runtime(
  options: ResolveNode24RuntimeOptions,
): Promise<Node24RuntimeResolution> {
  const env = options.env ?? process.env;
  const listDir = options.listDir ?? readdir;
  const home = (options.homedir ?? osHomedir)();
  const override = env[OPEN_KNOWLEDGE_NODE_ENV]?.trim();

  if (override) {
    try {
      if (!isAbsolute(override)) throw new Error('the path must be absolute');
      const nodePath = await (options.realpath ?? fsRealpath)(override);
      await validateNode24(nodePath, options.runCommand);
      return { kind: 'runtime', nodePath, source: 'override' };
    } catch (error) {
      throw new Error(`${OPEN_KNOWLEDGE_NODE_ENV} points to an invalid Node 24+ binary at ${override}: ${errorMessage(error)}`);
    }
  }

  const detectedManagers = await detectManagers(env, home, listDir);
  if (detectedManagers.length === 0) return { kind: 'none' };

  const candidates = (
    await Promise.all(detectedManagers.map((manager) => listRuntimeCandidates(manager, listDir)))
  ).flat();
  const eligibleCandidates = candidates
    .filter((candidate) => candidate.version.major >= MINIMUM_NODE_MAJOR)
    .sort((left, right) => compareVersions(right.version, left.version));

  for (const candidate of eligibleCandidates) {
    try {
      await validateNode24(candidate.nodePath, options.runCommand);
      return { kind: 'runtime', nodePath: candidate.nodePath, source: candidate.manager };
    } catch {
      // A partially removed runtime must not hide the next-highest working installation.
    }
  }

  return { kind: 'manager-without-24', manager: detectedManagers[0].definition.name };
}

export async function readShimOwnership(shimPath: string): Promise<OkShimOwnership> {
  try {
    const content = await readFile(shimPath, 'utf8');
    return content.includes(OVERDECK_SHIM_MARKER) ? 'overdeck' : 'foreign';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}

export async function writeOkShim(options: WriteOkShimOptions): Promise<string> {
  const shimPath = options.shimPath ?? join(osHomedir(), '.local', 'bin', 'ok');
  const ownership = await readShimOwnership(shimPath);
  if (ownership === 'foreign') {
    throw new Error(
      `Refusing to overwrite ${shimPath} because it is not an Overdeck-managed shim. Delete or fix that file, then retry.`,
    );
  }

  const content = [
    '#!/bin/sh',
    '# overdeck-managed shim (PAN-2984): pins open-knowledge to a Node 24 runtime.',
    '# Regenerate with `pan knowledge open`; safe to delete.',
    `exec "${escapeDoubleQuotedShell(options.nodePath)}" "${escapeDoubleQuotedShell(options.entryScript)}" "$@"`,
    '',
  ].join('\n');

  await mkdir(dirname(shimPath), { recursive: true });
  await writeFile(shimPath, content, { mode: 0o755 });
  await chmod(shimPath, 0o755);
  return shimPath;
}

async function detectManagers(
  env: NodeJS.ProcessEnv,
  home: string,
  listDir: NodeRuntimeListDir,
): Promise<DetectedManager[]> {
  const detected: DetectedManager[] = [];

  for (const definition of MANAGERS) {
    const configuredRoot = env[definition.envVar]?.trim();
    const roots = unique([...(configuredRoot ? [configuredRoot] : []), ...definition.defaultRoots(home)]);

    for (const root of roots) {
      if (await directoryExists(root, listDir)) {
        detected.push({ definition, root });
        break;
      }
    }
  }

  return detected;
}

async function listRuntimeCandidates(
  manager: DetectedManager,
  listDir: NodeRuntimeListDir,
): Promise<RuntimeCandidate[]> {
  const versionsDirectory = manager.definition.versionsDirectory(manager.root);
  let versionDirectories: readonly string[];
  try {
    versionDirectories = await listDir(versionsDirectory);
  } catch {
    return [];
  }

  const candidates: RuntimeCandidate[] = [];
  for (const versionDirectory of versionDirectories) {
    const version = parseVersion(versionDirectory);
    if (!version) continue;

    const nodePath = manager.definition.nodePath(versionsDirectory, versionDirectory);
    if (!(await fileAppearsInDirectory(nodePath, listDir))) continue;
    candidates.push({ manager: manager.definition.name, nodePath, version });
  }
  return candidates;
}

async function directoryExists(directory: string, listDir: NodeRuntimeListDir): Promise<boolean> {
  try {
    await listDir(directory);
    return true;
  } catch {
    return false;
  }
}

async function fileAppearsInDirectory(filePath: string, listDir: NodeRuntimeListDir): Promise<boolean> {
  try {
    const entries = await listDir(dirname(filePath));
    return entries.includes('node');
  } catch {
    return false;
  }
}

async function validateNode24(nodePath: string, runCommand: NodeRuntimeCommandRunner): Promise<void> {
  const result = await runCommand(nodePath, ['--version']);
  const version = parseVersion(result.stdout.trim());
  if (!version || version.major < MINIMUM_NODE_MAJOR) {
    const reported = result.stdout.trim() || 'no version';
    throw new Error(`expected Node 24+ but ${nodePath} reported ${reported}`);
  }
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeDoubleQuotedShell(value: string): string {
  return value.replace(/[\\"$`]/g, '\\$&');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
