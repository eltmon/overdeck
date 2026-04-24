import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, rmSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename, dirname, relative } from 'path';
import { homedir } from 'os';
import {
  SKILLS_DIR, COMMANDS_DIR, AGENTS_DIR, BIN_DIR,
  SOURCE_SCRIPTS_DIR, SOURCE_DEV_SKILLS_DIR, SOURCE_SKILLS_DIR, SOURCE_AGENTS_DIR, SOURCE_RULES_DIR,
  CACHE_AGENTS_DIR, CACHE_RULES_DIR, CACHE_MANIFEST,
  SYNC_TARGET, isDevMode,
} from './paths.js';
import {
  buildManifestFromDirectory, writeManifest, readManifest, hashFile,
  setManifestEntry, collectSourceFiles,
  type Manifest, type FileStatus,
  compareFileToManifest,
} from './manifest.js';
import { getDevrootPath } from './config.js';
import { applyModelOverridesToAgents } from './agent-model-sync.js';

export interface SyncItem {
  name: string;
  sourcePath: string;
  targetPath: string;
  status: 'new' | 'exists' | 'conflict' | 'symlink';
}

export interface SyncPlan {
  skills: SyncItem[];
  commands: SyncItem[];
  agents: SyncItem[];
  rules: SyncItem[];
  devSkills: SyncItem[];  // Developer-only skills (only synced in dev mode)
}

/**
 * Remove a file, symlink, or directory safely
 */
function removeTarget(targetPath: string): void {
  const stats = lstatSync(targetPath);
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    // It's a real directory, remove recursively
    rmSync(targetPath, { recursive: true, force: true });
  } else {
    // It's a file or symlink
    unlinkSync(targetPath);
  }
}

/**
 * Check if a path is a Panopticon-managed symlink
 */
export function isPanopticonSymlink(targetPath: string): boolean {
  if (!existsSync(targetPath)) return false;

  try {
    const stats = lstatSync(targetPath);
    if (!stats.isSymbolicLink()) return false;

    const linkTarget = readlinkSync(targetPath);
    // It's ours if it points to our skills/commands dir
    return linkTarget.includes('.panopticon');
  } catch {
    return false;
  }
}

export interface MigrationResult {
  removedSymlinks: string[];
  preservedUserContent: string[];
  errors: string[];
}

/**
 * One-time migration: remove Panopticon-managed symlinks from ~/.claude/.
 *
 * Detects symlinks in ~/.claude/skills/ and ~/.claude/agents/ that point to
 * .panopticon directories. Removes only those symlinks, preserving any
 * user-created content (real files/directories).
 *
 * This is safe to run multiple times — it's a no-op if nothing remains to clean up.
 *
 * Removes stale Panopticon content from ~/.claude/:
 * - Symlinks pointing to .panopticon or panopticon-cli (legacy sync method)
 *
 * Plain directories are always preserved as user content — there is no reliable
 * way to prove a plain directory was created by Panopticon vs the user.
 */
export function migrateStalePersonalContent(): MigrationResult {
  const claudeDir = join(homedir(), '.claude');
  const result: MigrationResult = {
    removedSymlinks: [],
    preservedUserContent: [],
    errors: [],
  };

  for (const subdir of ['skills', 'commands', 'agents']) {
    const dir = join(claudeDir, subdir);
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = lstatSync(entryPath);
          if (stats.isSymbolicLink()) {
            const linkTarget = readlinkSync(entryPath);
            if (linkTarget.includes('.panopticon') || linkTarget.includes('panopticon-cli')) {
              unlinkSync(entryPath);
              result.removedSymlinks.push(`${subdir}/${entry}`);
            } else {
              // Symlink to somewhere else — leave it
              result.preservedUserContent.push(`${subdir}/${entry}`);
            }
          } else {
            // Plain file or directory — user content, never touch
            result.preservedUserContent.push(`${subdir}/${entry}`);
          }
        } catch (err: any) {
          result.errors.push(`${subdir}/${entry}: ${err.message}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`${subdir}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Remove legacy skill directories from ~/.claude/skills/ that were renamed or deleted
 * in the 0.7.0 command taxonomy reorganization. Safe to call on every sync — if the
 * skills are already gone, it's a no-op.
 */
export function removeLegacySkills070(): string[] {
  // Skills renamed or removed in 0.7.0:
  // pan-issue → pan-start
  // pan-plan-finalize → deleted (subcommand of pan plan)
  // pan-setup → pan-admin-hooks
  // pan-rescue → pan-admin-cloister
  // pan-tldr → pan-admin-tldr
  // pan-config → pan-admin-config
  // pan-tracker → pan-admin-tracker
  const LEGACY_SKILL_NAMES = [
    'pan-issue',
    'pan-plan-finalize',
    'pan-setup',
    'pan-rescue',
    'pan-tldr',
    'pan-config',
    'pan-tracker',
  ];

  const removed: string[] = [];
  const skillsTarget = SYNC_TARGET.skills;
  if (!existsSync(skillsTarget)) return removed;

  for (const name of LEGACY_SKILL_NAMES) {
    const targetPath = join(skillsTarget, name);
    if (existsSync(targetPath)) {
      try {
        rmSync(targetPath, { recursive: true, force: true });
        removed.push(name);
      } catch {
        // Non-fatal — skip if removal fails
      }
    }
  }
  return removed;
}

export interface RefreshCacheResult {
  skills: { copied: number; total: number };
  agents: { copied: number; total: number };
  rules: { copied: number; total: number };
}

/**
 * Recursively copy a directory, overwriting existing files.
 */
function copyDirectoryRecursive(source: string, dest: string): number {
  if (!existsSync(source)) return 0;

  mkdirSync(dest, { recursive: true });
  let count = 0;

  const entries = readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(source, entry.name);
    const dstPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirectoryRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, dstPath);
      count++;
    }
  }
  return count;
}

/**
 * Refresh the ~/.panopticon/ cache from the repo source.
 *
 * Always copies (overwrites) skills, agents, and rules from the package's
 * source directories to the cache. Generates ~/.panopticon/.manifest.json
 * tracking all cached files.
 *
 * This replaces the old "skip if exists" behavior in `pan install`.
 */
export function refreshCache(): RefreshCacheResult {
  const result: RefreshCacheResult = {
    skills: { copied: 0, total: 0 },
    agents: { copied: 0, total: 0 },
    rules: { copied: 0, total: 0 },
  };

  // Copy skills from repo to cache (always overwrite)
  if (existsSync(SOURCE_SKILLS_DIR)) {
    const skillDirs = readdirSync(SOURCE_SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    result.skills.total = skillDirs.length;
    for (const skillDir of skillDirs) {
      const src = join(SOURCE_SKILLS_DIR, skillDir.name);
      const dst = join(SKILLS_DIR, skillDir.name);
      copyDirectoryRecursive(src, dst);
      result.skills.copied++;
    }
  }

  // Copy dev-skills to cache too (in dev mode only)
  if (isDevMode() && existsSync(SOURCE_DEV_SKILLS_DIR)) {
    const devSkillDirs = readdirSync(SOURCE_DEV_SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const skillDir of devSkillDirs) {
      const src = join(SOURCE_DEV_SKILLS_DIR, skillDir.name);
      const dst = join(SKILLS_DIR, skillDir.name);
      copyDirectoryRecursive(src, dst);
      result.skills.copied++;
      result.skills.total++;
    }
  }

  // Copy agent definitions from repo to cache
  if (existsSync(SOURCE_AGENTS_DIR)) {
    mkdirSync(CACHE_AGENTS_DIR, { recursive: true });
    const agents = readdirSync(SOURCE_AGENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'));

    result.agents.total = agents.length;
    for (const agent of agents) {
      copyFileSync(join(SOURCE_AGENTS_DIR, agent.name), join(CACHE_AGENTS_DIR, agent.name));
      result.agents.copied++;
    }
  }

  // Copy rules from repo to cache (directory may not exist yet)
  if (existsSync(SOURCE_RULES_DIR)) {
    const ruleFiles = readdirSync(SOURCE_RULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile());

    result.rules.total = ruleFiles.length;
    for (const rule of ruleFiles) {
      mkdirSync(CACHE_RULES_DIR, { recursive: true });
      copyFileSync(join(SOURCE_RULES_DIR, rule.name), join(CACHE_RULES_DIR, rule.name));
      result.rules.copied++;
    }
  }

  // Rewrite agent frontmatter `model:` per active work-type router config
  // BEFORE manifest generation, so the cache manifest hashes reflect the
  // post-override content. The router reads ~/.panopticon/config.yaml, so
  // changes to models.overrides propagate on the next refreshCache() call.
  applyModelOverridesToAgents();

  // Generate cache manifest
  const manifest = buildManifestFromDirectory(
    join(SKILLS_DIR, '..'),  // ~/.panopticon/
    ['skills', 'agent-definitions', 'rules'],
    'panopticon',
  );
  writeManifest(CACHE_MANIFEST, manifest);

  return result;
}

/**
 * Devroot sync item — represents a single file to distribute.
 */
export interface DevrootSyncItem {
  /** Relative path from .claude/ (e.g., "skills/beads/SKILL.md") */
  relativePath: string;
  /** Absolute path to source file in cache */
  sourcePath: string;
  /** Absolute path to target file at devroot */
  targetPath: string;
  /** What action to take */
  status: FileStatus;
}

/**
 * Plan what would be synced to devroot (dry run).
 * Reads from cache, targets <devroot>/.claude/, uses manifest comparison.
 */
export function planSync(): SyncPlan {
  const plan: SyncPlan = {
    skills: [],
    commands: [],
    agents: [],
    rules: [],
    devSkills: [],
  };

  const devrootPath = getDevrootPath();
  if (!devrootPath) return plan;

  const targetBase = join(devrootPath, '.claude');
  const manifestPath = join(targetBase, '.panopticon-manifest.json');
  const manifest = readManifest(manifestPath);

  // Plan skills
  const skillFiles = collectSourceFiles(SKILLS_DIR, 'skills/');
  for (const file of skillFiles) {
    const targetFile = join(targetBase, file.relativePath);
    const status = compareFileToManifest(targetFile, file.relativePath, manifest);
    const skillName = file.relativePath.split('/')[1] || file.relativePath;

    let syncStatus: SyncItem['status'] = 'new';
    if (status.action === 'update') syncStatus = 'symlink';  // reusing 'symlink' for "managed, safe to update"
    else if (status.action === 'modified') syncStatus = 'conflict';
    else if (status.action === 'user-owned') syncStatus = 'conflict';

    plan.skills.push({
      name: file.relativePath,
      sourcePath: file.absolutePath,
      targetPath: targetFile,
      status: syncStatus,
    });
  }

  // Plan agents
  const agentFiles = collectSourceFiles(CACHE_AGENTS_DIR, 'agents/');
  for (const file of agentFiles) {
    const targetFile = join(targetBase, file.relativePath);
    const status = compareFileToManifest(targetFile, file.relativePath, manifest);

    let syncStatus: SyncItem['status'] = 'new';
    if (status.action === 'update') syncStatus = 'symlink';
    else if (status.action === 'modified') syncStatus = 'conflict';
    else if (status.action === 'user-owned') syncStatus = 'conflict';

    plan.agents.push({
      name: file.relativePath,
      sourcePath: file.absolutePath,
      targetPath: targetFile,
      status: syncStatus,
    });
  }

  // Plan rules
  const ruleFiles = collectSourceFiles(CACHE_RULES_DIR, 'rules/');
  for (const file of ruleFiles) {
    const targetFile = join(targetBase, file.relativePath);
    const status = compareFileToManifest(targetFile, file.relativePath, manifest);

    let syncStatus: SyncItem['status'] = 'new';
    if (status.action === 'update') syncStatus = 'symlink';
    else if (status.action === 'modified') syncStatus = 'conflict';
    else if (status.action === 'user-owned') syncStatus = 'conflict';

    plan.rules.push({
      name: file.relativePath,
      sourcePath: file.absolutePath,
      targetPath: targetFile,
      status: syncStatus,
    });
  }

  return plan;
}

export interface SyncOptions {
  force?: boolean;
  diff?: boolean;
  dryRun?: boolean;
}

export interface SyncResult {
  created: string[];
  updated: string[];
  skipped: string[];
  conflicts: string[];
  diffs: Array<{ path: string; sourceContent: string; targetContent: string }>;
}

/**
 * Execute sync to devroot: copy from cache to <devroot>/.claude/.
 * Uses manifest-based conflict resolution. NEVER touches ~/.claude/.
 */
export function executeSync(options: SyncOptions = {}): SyncResult {
  const result: SyncResult = {
    created: [],
    updated: [],
    skipped: [],
    conflicts: [],
    diffs: [],
  };

  const devrootPath = getDevrootPath();
  if (!devrootPath) {
    return result;
  }

  const targetBase = join(devrootPath, '.claude');
  const manifestPath = join(targetBase, '.panopticon-manifest.json');
  const manifest = readManifest(manifestPath);

  // Collect all source files from cache
  const allFiles = [
    ...collectSourceFiles(SKILLS_DIR, 'skills/'),
    ...collectSourceFiles(CACHE_AGENTS_DIR, 'agents/'),
    ...collectSourceFiles(CACHE_RULES_DIR, 'rules/'),
  ];

  for (const file of allFiles) {
    const targetFile = join(targetBase, file.relativePath);
    const status = compareFileToManifest(targetFile, file.relativePath, manifest);

    switch (status.action) {
      case 'new': {
        // File doesn't exist at target — copy it
        mkdirSync(dirname(targetFile), { recursive: true });
        copyFileSync(file.absolutePath, targetFile);
        const hash = hashFile(targetFile);
        setManifestEntry(manifest, file.relativePath, hash, 'panopticon');
        result.created.push(file.relativePath);
        break;
      }

      case 'update': {
        // File exists, hash matches manifest — safe to overwrite (user didn't modify)
        mkdirSync(dirname(targetFile), { recursive: true });
        copyFileSync(file.absolutePath, targetFile);
        const hash = hashFile(targetFile);
        setManifestEntry(manifest, file.relativePath, hash, 'panopticon');
        result.updated.push(file.relativePath);
        break;
      }

      case 'modified': {
        // File was modified since we placed it
        if (options.diff) {
          result.diffs.push({
            path: file.relativePath,
            sourceContent: readFileSync(file.absolutePath, 'utf-8'),
            targetContent: readFileSync(targetFile, 'utf-8'),
          });
        }

        if (options.force) {
          mkdirSync(dirname(targetFile), { recursive: true });
          copyFileSync(file.absolutePath, targetFile);
          const hash = hashFile(targetFile);
          setManifestEntry(manifest, file.relativePath, hash, 'panopticon');
          result.updated.push(file.relativePath);
        } else {
          result.conflicts.push(file.relativePath);
        }
        break;
      }

      case 'user-owned': {
        // User placed this file, never touch it
        result.skipped.push(file.relativePath);
        break;
      }
    }
  }

  // Write updated manifest
  writeManifest(manifestPath, manifest);

  return result;
}

/**
 * Hook item for sync planning
 */
export interface HookItem {
  name: string;
  sourcePath: string;
  targetPath: string;
  status: 'new' | 'updated' | 'current';
}

/**
 * Plan hooks sync (checks what would be updated)
 */
export function planHooksSync(): HookItem[] {
  const hooks: HookItem[] = [];

  if (!existsSync(SOURCE_SCRIPTS_DIR)) {
    return hooks;
  }

  // Sync hook scripts (no extension) and bundled JS scripts (.js)
  // Skip source files (.ts), shell helpers (.sh), and other non-hook files (.mjs)
  const scripts = readdirSync(SOURCE_SCRIPTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.')
      && (!entry.name.includes('.') || entry.name.endsWith('.js')));

  for (const script of scripts) {
    const sourcePath = join(SOURCE_SCRIPTS_DIR, script.name);
    const targetPath = join(BIN_DIR, script.name);

    let status: HookItem['status'] = 'new';

    if (existsSync(targetPath)) {
      // Could compare file contents/timestamps here for 'current' vs 'updated'
      // For now, always update to ensure latest version
      status = 'updated';
    }

    hooks.push({ name: script.name, sourcePath, targetPath, status });
  }

  return hooks;
}

/**
 * Sync hooks (copy scripts to ~/.panopticon/bin/)
 */
export function syncHooks(): { synced: string[]; errors: string[] } {
  const result = { synced: [] as string[], errors: [] as string[] };

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true });

  const hooks = planHooksSync();

  for (const hook of hooks) {
    try {
      copyFileSync(hook.sourcePath, hook.targetPath);
      chmodSync(hook.targetPath, 0o755); // Make executable
      result.synced.push(hook.name);
    } catch (error) {
      result.errors.push(`${hook.name}: ${error}`);
    }
  }

  return result;
}

/**
 * Runtime-specific statusline configurations
 * Maps runtime to: config dir, statusline filename, settings file
 */
const STATUSLINE_TARGETS: Record<string, { configDir: string; scriptName: string; settingsFile: string }> = {
  claude: {
    configDir: join(homedir(), '.claude'),
    scriptName: 'statusline-command.sh',
    settingsFile: join(homedir(), '.claude', 'settings.json'),
  },
  // Other runtimes can be added as they support statusline
};

/**
 * Sync statusline script to all supported runtimes
 * Copies the canonical statusline.sh from panopticon scripts to each runtime's config dir
 * and ensures the runtime's settings.json references it.
 */
export function syncStatusline(): { synced: string[]; errors: string[] } {
  const result = { synced: [] as string[], errors: [] as string[] };

  const sourceScript = join(SOURCE_SCRIPTS_DIR, 'statusline.sh');
  if (!existsSync(sourceScript)) {
    return result;
  }

  for (const [runtime, target] of Object.entries(STATUSLINE_TARGETS)) {
    try {
      // Ensure config dir exists
      mkdirSync(target.configDir, { recursive: true });

      // Copy statusline script
      const targetScript = join(target.configDir, target.scriptName);
      copyFileSync(sourceScript, targetScript);
      chmodSync(targetScript, 0o755);

      // Update settings.json to reference the statusline
      updateSettingsStatusline(target.settingsFile, targetScript);

      result.synced.push(runtime);
    } catch (error) {
      result.errors.push(`${runtime}: ${error}`);
    }
  }

  return result;
}

/**
 * Update a settings.json file to include the statusLine configuration
 * Preserves all existing settings (hooks, etc.)
 */
function updateSettingsStatusline(settingsFile: string, scriptPath: string): void {
  let settings: Record<string, any> = {};

  if (existsSync(settingsFile)) {
    try {
      settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
    } catch {
      // If settings file is corrupt, start fresh but preserve the file
      settings = {};
    }
  }

  // Only update if statusLine is missing or points to a different script
  const currentCommand = settings.statusLine?.command;
  if (currentCommand === scriptPath && settings.statusLine?.type === 'command') {
    return; // Already configured correctly
  }

  settings.statusLine = {
    type: 'command',
    command: scriptPath,
    padding: 0,
  };

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export interface SkillsMirrorResult {
  added: string[];
  updated: string[];
  removed: string[];
}

/**
 * Recursively sync the contents of srcDir into dstDir (full mirror-copy).
 * nameMap (shallow, top-level only): renames source entries on copy (used to
 * normalise skill.md → SKILL.md).
 * Returns true if any file or directory was added, updated, or removed.
 */
function syncDirContents(
  srcDir: string,
  dstDir: string,
  nameMap?: Record<string, string>,
): boolean {
  mkdirSync(dstDir, { recursive: true });
  let changed = false;
  const dstKept = new Set<string>();

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const dstName = nameMap?.[entry.name] ?? entry.name;
    dstKept.add(dstName);
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, dstName);
    if (entry.isDirectory()) {
      if (syncDirContents(src, dst)) changed = true;
    } else if (entry.isFile()) {
      const srcStat = lstatSync(src);
      const srcMode = srcStat.mode & 0o777;
      const srcBuf = readFileSync(src);
      const dstExists = existsSync(dst);
      const dstBuf = dstExists ? readFileSync(dst) : null;
      const dstMode = dstExists ? lstatSync(dst).mode & 0o777 : null;
      if (!dstBuf || !srcBuf.equals(dstBuf)) {
        writeFileSync(dst, srcBuf);
        chmodSync(dst, srcMode);
        changed = true;
      } else if (dstMode !== srcMode) {
        chmodSync(dst, srcMode);
        changed = true;
      }
    }
  }

  try {
    for (const entry of readdirSync(dstDir, { withFileTypes: true })) {
      if (!dstKept.has(entry.name)) {
        rmSync(join(dstDir, entry.name), { recursive: true, force: true });
        changed = true;
      }
    }
  } catch { /* non-fatal */ }

  return changed;
}

/**
 * Walk up from startDir to find the nearest ancestor (inclusive) that contains a
 * skills/ directory with at least one SKILL.md-bearing subdirectory.
 * Returns the resolved root path, or null if not found.
 */
function resolveSkillsRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'skills');
    if (existsSync(candidate)) {
      try {
        for (const entry of readdirSync(candidate, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (existsSync(join(candidate, entry.name, 'SKILL.md')) ||
              existsSync(join(candidate, entry.name, 'skill.md'))) {
            return dir;
          }
        }
      } catch { /* non-readable — keep walking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Mirror the top-level skills/ directory into .claude/skills/ when run inside a
 * panopticon-cli-style project that has a skills/ tree with SKILL.md files.
 *
 * - Creates missing skill directories and recursively copies all their contents
 * - Updates out-of-date files when source content has changed
 * - Removes files and directories in .claude/skills/<name>/ that no longer exist in source
 * - Removes directories in .claude/skills/ that no longer exist in skills/
 * - Preserves .claude/skills/.gitignore untouched
 * - No-op for any project without a top-level skills/ directory containing SKILL.md files
 * - Safe to call from any subdirectory — walks up to find the project root
 *
 * @param cwd Working directory to check (defaults to process.cwd())
 */

/** Returns names of subdirs inside targetDir that are tracked by git in projectRoot. */
function getGitTrackedSkillDirNames(targetDir: string, projectRoot: string): Set<string> {
  const names = new Set<string>();
  try {
    const rel = relative(projectRoot, targetDir).replace(/\\/g, '/');
    const output = execSync(
      `git ls-files --full-name -- "${rel}/"`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    );
    const prefix = rel + '/';
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const rest = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
      const name = rest.split('/')[0];
      if (name) names.add(name);
    }
  } catch {
    // Not a git repo or git unavailable — fall back to manifest-only ownership check
  }
  return names;
}

export function mirrorProjectSkills(
  cwd: string = process.cwd(),
  opts?: { manifestDir?: string },
): SkillsMirrorResult {
  const result: SkillsMirrorResult = { added: [], updated: [], removed: [] };

  const resolvedCwd = resolveSkillsRoot(cwd) ?? cwd;
  const sourceDir = join(resolvedCwd, 'skills');
  const targetDir = join(resolvedCwd, '.claude', 'skills');

  if (!existsSync(sourceDir)) return result;

  // Verify this is a project with actual skill definitions (has at least one SKILL.md)
  let hasSkillFiles = false;
  try {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(sourceDir, entry.name, 'SKILL.md')) ||
          existsSync(join(sourceDir, entry.name, 'skill.md'))) {
        hasSkillFiles = true;
        break;
      }
    }
  } catch {
    return result;
  }
  if (!hasSkillFiles) return result;

  mkdirSync(targetDir, { recursive: true });

  // Manifest lives outside the repo to avoid creating untracked files in .claude/skills/.
  // Default: ~/.panopticon/state/mirrors/<escaped-resolvedCwd>/manifest
  // Testable via opts.manifestDir.
  const manifestDir =
    opts?.manifestDir ??
    join(homedir(), '.panopticon', 'state', 'mirrors', resolvedCwd.replace(/[/\\:]/g, '_'));
  mkdirSync(manifestDir, { recursive: true });
  // Read manifest BEFORE the mirror loop so we can check ownership on existing target dirs.
  // Only mirror-managed dirs (listed in the manifest) may be overwritten; dirs that pre-existed
  // and are not in the manifest are user-managed and must not be touched.
  const manifestPath = join(manifestDir, 'manifest');
  const manifestNames = new Set<string>();
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    for (const line of content.split('\n')) {
      const name = line.trim();
      if (name) manifestNames.add(name);
    }
  } catch {
    // No manifest yet — nothing was previously managed, nothing to delete
  }

  // Git-tracked names: dirs inside targetDir that are committed in the repo.
  // These are canonical repo content — safe to mirror even on first run, before any manifest entry.
  const gitTrackedNames = getGitTrackedSkillDirNames(targetDir, resolvedCwd);

  // sourceNames: all valid source skills (used to guard against removing non-source dirs)
  // mirroredNames: skills actually synced this run (written to manifest)
  const sourceNames = new Set<string>();
  const mirroredNames = new Set<string>();

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourcePath = join(sourceDir, entry.name);

    const hasUpperSKILL = existsSync(join(sourcePath, 'SKILL.md'));
    const hasLowerSkill = !hasUpperSKILL && existsSync(join(sourcePath, 'skill.md'));
    if (!hasUpperSKILL && !hasLowerSkill) continue; // skip dirs without a skill definition

    sourceNames.add(entry.name);
    const targetPath = join(targetDir, entry.name);
    const targetExists = existsSync(targetPath);

    // Ownership guard: if the target dir already exists but is neither in the mirror manifest
    // nor git-tracked (canonical repo content), treat it as user-managed — leave it untouched.
    if (targetExists && !manifestNames.has(entry.name) && !gitTrackedNames.has(entry.name)) continue;

    // Track whether the target already had a SKILL.md (to distinguish added vs updated)
    const targetHadSkillMd = targetExists && (
      existsSync(join(targetPath, 'SKILL.md')) || existsSync(join(targetPath, 'skill.md'))
    );

    // Rename skill.md → SKILL.md when source uses lowercase
    const nameMap = hasLowerSkill ? { 'skill.md': 'SKILL.md' } : undefined;

    const changed = syncDirContents(sourcePath, targetPath, nameMap);
    mirroredNames.add(entry.name);

    if (changed) {
      if (targetHadSkillMd) {
        result.updated.push(entry.name);
      } else {
        result.added.push(entry.name);
      }
    }
  }

  // Remove mirror-managed dirs that no longer exist in source
  try {
    for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (manifestNames.has(entry.name) && !sourceNames.has(entry.name)) {
        rmSync(join(targetDir, entry.name), { recursive: true, force: true });
        result.removed.push(entry.name);
      }
    }
  } catch {
    // Non-fatal — target may not exist or be unreadable
  }

  // Update manifest to reflect only the skills we mirrored (not user-managed pre-existing dirs)
  const sortedMirrored = Array.from(mirroredNames).sort();
  writeFileSync(manifestPath, sortedMirrored.join('\n') + '\n', 'utf-8');

  return result;
}
