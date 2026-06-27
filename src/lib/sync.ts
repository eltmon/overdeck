import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, rmSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { createHash, type Hash } from 'crypto';
import { join, basename, dirname, relative } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import {
  SKILLS_DIR, COMMANDS_DIR, AGENTS_DIR, BIN_DIR, CLAUDE_DIR,
  SYNC_SOURCES,
  CACHE_AGENTS_DIR, CACHE_RULES_DIR, CACHE_MANIFEST,
  SYNC_TARGET, isDevMode, OVERDECK_HOME,
} from './paths.js';
import { FsError } from './errors.js';
import {
  buildManifestFromDirectory, writeManifestSync, readManifestSync, hashFileSync,
  setManifestEntry, collectSourceFilesSync,
  type Manifest,
  compareFileToManifest,
} from './manifest.js';
import { listProjectsSync } from './projects.js';
import {
  ensureGlobalLayer,
  renderGlobalLayer,
  renderProjectLayer,
  applyManagedRegion,
  hasManagedRegion,
  piGlobalContextFile,
  codexGlobalContextFile,
} from './context-layers/index.js';
import { backupFileSync, createBackupTimestamp } from './backup.js';

export interface SyncItem {
  name: string;
  sourcePath: string;
  targetPath: string;
  status: 'new' | 'exists' | 'conflict' | 'symlink' | 'adopted';
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
 * Check if a path is a Overdeck-managed symlink
 */
export function isOverdeckSymlinkSync(targetPath: string): boolean {
  if (!existsSync(targetPath)) return false;

  try {
    const stats = lstatSync(targetPath);
    if (!stats.isSymbolicLink()) return false;

    const linkTarget = readlinkSync(targetPath);
    // It's ours if it points to our skills/commands dir
    return linkTarget.includes('.overdeck');
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
 * One-time migration: remove Overdeck-managed symlinks from ~/.claude/.
 *
 * Detects symlinks in ~/.claude/skills/ and ~/.claude/agents/ that point to
 * .overdeck directories. Removes only those symlinks, preserving any
 * user-created content (real files/directories).
 *
 * This is safe to run multiple times — it's a no-op if nothing remains to clean up.
 *
 * Removes stale Overdeck content from ~/.claude/:
 * - Symlinks pointing to .overdeck or overdeck (legacy sync method)
 *
 * Plain directories are always preserved as user content — there is no reliable
 * way to prove a plain directory was created by Overdeck vs the user.
 */
export function migrateStalePersonalContentSync(): MigrationResult {
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
            if (linkTarget.includes('.overdeck') || linkTarget.includes('overdeck')) {
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
export function removeLegacySkills070Sync(): string[] {
  // Skills renamed or removed in 0.7.0:
  // pan-issue → pan-start
  // pan-plan-finalize → deleted (subcommand of pan plan)
  // pan-setup → pan-admin-hooks
  // pan-rescue → pan-admin-cloister
  // pan-config → pan-admin-config
  // pan-tracker → pan-admin-tracker
  //
  // pan-tldr was previously listed here when admin moved to pan-admin-tldr,
  // but pan-tldr is now a separate work-agent-facing skill (different scope
  // from the admin skill — it teaches agents to USE the TLDR MCP tools).
  // PAN-1132.
  const LEGACY_SKILL_NAMES = [
    'pan-issue',
    'pan-plan-finalize',
    'pan-setup',
    'pan-rescue',
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
 * Refresh the ~/.overdeck/ cache from the repo source.
 *
 * Always copies (overwrites) skills, agents, and rules from the package's
 * source directories to the cache. Generates ~/.overdeck/.manifest.json
 * tracking all cached files.
 *
 * This replaces the old "skip if exists" behavior in `pan install`.
 */
export function refreshCacheSync(): RefreshCacheResult {
  const result: RefreshCacheResult = {
    skills: { copied: 0, total: 0 },
    agents: { copied: 0, total: 0 },
    rules: { copied: 0, total: 0 },
  };

  // Copy skills from repo to cache (always overwrite)
  if (existsSync(SYNC_SOURCES.skills)) {
    const skillDirs = readdirSync(SYNC_SOURCES.skills, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    result.skills.total = skillDirs.length;
    for (const skillDir of skillDirs) {
      const src = join(SYNC_SOURCES.skills, skillDir.name);
      const dst = join(SKILLS_DIR, skillDir.name);
      copyDirectoryRecursive(src, dst);
      result.skills.copied++;
    }
  }

  // Copy dev-skills to cache too (in dev mode only)
  if (isDevMode() && existsSync(SYNC_SOURCES.devSkills)) {
    const devSkillDirs = readdirSync(SYNC_SOURCES.devSkills, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const skillDir of devSkillDirs) {
      const src = join(SYNC_SOURCES.devSkills, skillDir.name);
      const dst = join(SKILLS_DIR, skillDir.name);
      copyDirectoryRecursive(src, dst);
      result.skills.copied++;
      result.skills.total++;
    }
  }

  // Copy agent definitions from repo to cache.
  //
  // PAN-982: This pass deploys both Claude Code subagent definitions
  // (codebase-explorer, planning-agent, triage-agent, health-monitor — used by
  // the in-session Agent tool) and the Overdeck pipeline agents
  // (pan-work-agent, pan-planning-agent, pan-review-agent, pan-test-agent,
  // pan-inspect-agent, pan-uat-agent, pan-merge-agent — used by `claude --agent
  // pan-<type>-agent` when Cloister spawns the work/review/test/inspect/uat/
  // merge processes).
  //
  // Both kinds live side by side in the repo's `agents/` directory and both get
  // mirrored into ~/.overdeck/agent-definitions/ here, then on to
  // <devroot>/.claude/agents/ via planSync/executeSync. The downstream sync
  // never deletes existing files in the target, so non-Overdeck agent
  // definitions a project may have authored stay intact.
  if (existsSync(SYNC_SOURCES.agents)) {
    mkdirSync(CACHE_AGENTS_DIR, { recursive: true });
    const agents = readdirSync(SYNC_SOURCES.agents, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'));

    result.agents.total = agents.length;
    for (const agent of agents) {
      copyFileSync(join(SYNC_SOURCES.agents, agent.name), join(CACHE_AGENTS_DIR, agent.name));
      result.agents.copied++;
    }

    // PAN-982: Warn if any of the pipeline agent definitions are missing from the
    // source. Cloister depends on these names existing in <devroot>/.claude/agents/
    // — otherwise `claude --agent pan-<type>-agent` exits immediately with
    // "agent not found". Surfacing the gap during sync is far cheaper than
    // discovering it when a work/review/test/inspect/uat/merge spawn fails.
    const REQUIRED_PIPELINE_AGENTS = [
      'pan-work-agent.md',
      'pan-planning-agent.md',
      'pan-review-agent.md',
      'pan-test-agent.md',
      'pan-inspect-agent.md',
      'pan-uat-agent.md',
      'pan-merge-agent.md',
    ];
    const presentNames = new Set(agents.map((a) => a.name));
    const missing = REQUIRED_PIPELINE_AGENTS.filter((name) => !presentNames.has(name));
    if (missing.length > 0) {
      console.warn(
        `[sync] WARN: pipeline agent definition(s) missing from agents/: ${missing.join(', ')}. ` +
          `Cloister will fail to spawn the corresponding specialists with --agent.`,
      );
    }
  }

  // Copy rules from repo to cache (directory may not exist yet)
  if (existsSync(SYNC_SOURCES.rules)) {
    const ruleFiles = readdirSync(SYNC_SOURCES.rules, { withFileTypes: true })
      .filter((entry) => entry.isFile());

    result.rules.total = ruleFiles.length;
    for (const rule of ruleFiles) {
      mkdirSync(CACHE_RULES_DIR, { recursive: true });
      copyFileSync(join(SYNC_SOURCES.rules, rule.name), join(CACHE_RULES_DIR, rule.name));
      result.rules.copied++;
    }
  }

  // Generate cache manifest
  const manifest = buildManifestFromDirectory(
    join(SKILLS_DIR, '..'),  // ~/.overdeck/
    ['skills', 'agent-definitions', 'rules'],
    'overdeck',
  );
  writeManifestSync(CACHE_MANIFEST, manifest);

  return result;
}

/**
 * Plan what `pan sync` would distribute to ~/.claude/ (dry run).
 *
 * PAN-1201: targets the user's Claude Code home directly — the layered
 * context model replaced the old `<devroot>/.claude/` indirection. Skills
 * and agents are distributed as files; rules now fold into CLAUDE.md (see
 * the context-layers subsystem) and are not planned here.
 */
export function planSyncSync(): SyncPlan {
  const plan: SyncPlan = {
    skills: [],
    commands: [],
    agents: [],
    rules: [],
    devSkills: [],
  };

  const targetBase = CLAUDE_DIR;
  const manifestPath = join(targetBase, '.overdeck-manifest.json');
  const manifest = readManifestSync(manifestPath);

  const planInto = (sourceDir: string, prefix: string, bucket: SyncItem[]): void => {
    for (const file of collectSourceFilesSync(sourceDir, prefix)) {
      const targetFile = join(targetBase, file.relativePath);
      const status = compareFileToManifest(targetFile, file.relativePath, manifest);

      let syncStatus: SyncItem['status'] = 'new';
      if (status.action === 'update') {
        syncStatus = 'symlink'; // 'symlink' here means "managed, safe to update"
      } else if (status.action === 'modified') {
        syncStatus = 'conflict';
      } else if (status.action === 'user-owned') {
        // Identical content sitting at the target from a previous Overdeck
        // era is not a conflict — it would simply be adopted on the real run.
        syncStatus = hashFileSync(targetFile) === hashFileSync(file.absolutePath) ? 'exists' : 'adopted';
      }

      bucket.push({
        name: file.relativePath,
        sourcePath: file.absolutePath,
        targetPath: targetFile,
        status: syncStatus,
      });
    }
  };

  planInto(SKILLS_DIR, 'skills/', plan.skills);
  planInto(CACHE_AGENTS_DIR, 'agents/', plan.agents);

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
  adopted: string[];
  skipped: string[];
  conflicts: string[];
  diffs: Array<{ path: string; sourceContent: string; targetContent: string }>;
}

/**
 * Distribute cached skills and agents into the user's Claude Code home
 * (~/.claude/skills/, ~/.claude/agents/).
 *
 * PAN-1201: this is the Global → claude-code half of the sync output map.
 * It targets ~/.claude/ directly — the deprecated `<devroot>/.claude/`
 * indirection is gone. Rules are no longer distributed as files; they fold
 * into the rendered CLAUDE.md instead (see syncContextLayers()).
 *
 * Conflict resolution is manifest-based. A file already at the target but
 * absent from the manifest (a prior Overdeck era, or a fresh ~/.claude)
 * is *adopted* when its content is byte-identical to our source — recorded
 * into the manifest so future syncs can update it. A target file that
 * differs at an Overdeck-shipped source path is a legacy pre-manifest
 * install; it is overwritten, recorded in the manifest, and reported as
 * adopted.
 */
export function executeSyncSync(options: SyncOptions = {}): SyncResult {
  const result: SyncResult = {
    created: [],
    updated: [],
    adopted: [],
    skipped: [],
    conflicts: [],
    diffs: [],
  };

  const targetBase = CLAUDE_DIR;
  const manifestPath = join(targetBase, '.overdeck-manifest.json');
  const manifest = readManifestSync(manifestPath);

  // Collect all source files from cache (skills + agent definitions).
  const allFiles = [
    ...collectSourceFilesSync(SKILLS_DIR, 'skills/'),
    ...collectSourceFilesSync(CACHE_AGENTS_DIR, 'agents/'),
  ];

  for (const file of allFiles) {
    const targetFile = join(targetBase, file.relativePath);
    const status = compareFileToManifest(targetFile, file.relativePath, manifest);

    switch (status.action) {
      case 'new': {
        // File doesn't exist at target — copy it
        mkdirSync(dirname(targetFile), { recursive: true });
        copyFileSync(file.absolutePath, targetFile);
        const hash = hashFileSync(targetFile);
        setManifestEntry(manifest, file.relativePath, hash, 'overdeck');
        result.created.push(file.relativePath);
        break;
      }

      case 'update': {
        // File exists, hash matches manifest — safe to overwrite (user didn't modify)
        mkdirSync(dirname(targetFile), { recursive: true });
        copyFileSync(file.absolutePath, targetFile);
        const hash = hashFileSync(targetFile);
        setManifestEntry(manifest, file.relativePath, hash, 'overdeck');
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
          const hash = hashFileSync(targetFile);
          setManifestEntry(manifest, file.relativePath, hash, 'overdeck');
          result.updated.push(file.relativePath);
        } else {
          result.conflicts.push(file.relativePath);
        }
        break;
      }

      case 'user-owned': {
        // Target file exists but is absent from the manifest. If its content
        // is byte-identical to our source, it is ours (a prior era) — adopt
        // it so future syncs can manage it. If it differs at a bundled source
        // path, it is a legacy pre-manifest Overdeck install: overwrite and
        // record it explicitly so the operator sees the adoption.
        if (hashFileSync(targetFile) === hashFileSync(file.absolutePath)) {
          setManifestEntry(manifest, file.relativePath, hashFileSync(targetFile), 'overdeck');
          result.skipped.push(file.relativePath);
        } else {
          mkdirSync(dirname(targetFile), { recursive: true });
          copyFileSync(file.absolutePath, targetFile);
          const hash = hashFileSync(targetFile);
          setManifestEntry(manifest, file.relativePath, hash, 'overdeck');
          result.adopted.push(file.relativePath);
        }
        break;
      }
    }
  }

  // Write updated manifest
  writeManifestSync(manifestPath, manifest);

  return result;
}

/** A target file whose pre-existing hand-authored content was backed up the
 *  first time `pan sync` injected a managed region into it. */
export interface ContextFirstInjection {
  /** The target file (e.g. ~/.claude/CLAUDE.md, <root>/AGENTS.md). */
  file: string;
  /** Where the pre-existing content was snapshotted before injection. */
  backupPath: string;
}

export interface ContextLayerSyncResult {
  /** True when ~/.claude/CLAUDE.md's managed region was written this run. */
  globalWritten: boolean;
  /** True when global.md did not exist and a starter template was seeded. */
  globalStubCreated: boolean;
  /** Names of registered projects whose CLAUDE.md/AGENTS.md was written this run. */
  projectsWritten: string[];
  /** True when ~/.overdeck/context/pi-global.md was written this run. */
  piGlobalWritten: boolean;
  /** True when ~/.overdeck/context/codex-global.md was written this run. */
  codexGlobalWritten: boolean;
  /** Files where a managed region was injected into pre-existing content for
   *  the first time this run (each backed up first). */
  firstInjections: ContextFirstInjection[];
  errors: string[];
}

/**
 * Write a managed region into `targetFile`, preserving any hand-authored
 * content outside the markers. Returns true when the file changed. The first
 * time a region is injected into a non-empty file with no existing region, the
 * file is backed up first and recorded in `result.firstInjections`.
 */
function writeManagedTargetSync(
  targetFile: string,
  managed: string,
  result: ContextLayerSyncResult,
  backupTimestamp: string,
): boolean {
  const existing = existsSync(targetFile) ? readFileSync(targetFile, 'utf-8') : '';
  const next = applyManagedRegion(existing, managed);
  if (next === existing) return false;
  if (existing.trim().length > 0 && !hasManagedRegion(existing)) {
    const backupPath = backupFileSync(targetFile, backupTimestamp);
    if (backupPath) result.firstInjections.push({ file: targetFile, backupPath });
  }
  mkdirSync(dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, next, 'utf-8');
  return true;
}

/**
 * Render the global and project context layers into harness CLAUDE.md files.
 *
 * PAN-1201: the layered-context half of `pan sync`. The global layer
 * (~/.overdeck/context/global.md + the folded bundled rules) renders into
 * the managed region of ~/.claude/CLAUDE.md; each registered project's
 * `.pan/context/project.md` renders into the managed region of its own
 * CLAUDE.md. Content outside the managed region is preserved untouched, so a
 * hand-authored CLAUDE.md is never clobbered.
 */
export function syncContextLayersSync(): ContextLayerSyncResult {
  const result: ContextLayerSyncResult = {
    globalWritten: false,
    globalStubCreated: false,
    projectsWritten: [],
    piGlobalWritten: false,
    codexGlobalWritten: false,
    firstInjections: [],
    errors: [],
  };
  // One backup dir for every first-injection this run.
  const backupTimestamp = createBackupTimestamp();

  // Global layer → ~/.claude/CLAUDE.md
  result.globalStubCreated = ensureGlobalLayer();
  try {
    const managed = renderGlobalLayer('claude-code', isDevMode());
    const claudeMd = join(CLAUDE_DIR, 'CLAUDE.md');
    if (writeManagedTargetSync(claudeMd, managed, result, backupTimestamp)) {
      result.globalWritten = true;
    }
  } catch (err: any) {
    result.errors.push(`global: ${err?.message ?? err}`);
  }

  // PAN-1566/PAN-1989: Global layer → ~/.overdeck/context/pi-global.md (ohmypi harness)
  try {
    const piManaged = renderGlobalLayer('ohmypi', isDevMode());
    const piGlobalFile = piGlobalContextFile();
    const existingPi = existsSync(piGlobalFile) ? readFileSync(piGlobalFile, 'utf-8') : '';
    if (piManaged.trim() !== existingPi.trim()) {
      mkdirSync(dirname(piGlobalFile), { recursive: true });
      writeFileSync(piGlobalFile, piManaged.trim() + '\n', 'utf-8');
      result.piGlobalWritten = true;
    }
  } catch (err: any) {
    result.errors.push(`pi-global: ${err?.message ?? err}`);
  }

  // PAN-1574: Global layer → ~/.overdeck/context/codex-global.md
  // This static file is copied into each agent's CODEX_HOME/AGENTS.md at spawn time
  // by initCodexHome(), keeping Codex context isolated from the project-root AGENTS.md.
  try {
    const codexManaged = renderGlobalLayer('codex', isDevMode());
    const codexGlobalFile = codexGlobalContextFile();
    const existingCodex = existsSync(codexGlobalFile) ? readFileSync(codexGlobalFile, 'utf-8') : '';
    if (codexManaged.trim() !== existingCodex.trim()) {
      mkdirSync(dirname(codexGlobalFile), { recursive: true });
      writeFileSync(codexGlobalFile, codexManaged.trim() + '\n', 'utf-8');
      result.codexGlobalWritten = true;
    }
  } catch (err: any) {
    result.errors.push(`codex-global: ${err?.message ?? err}`);
  }

  // Project layers → <projectRoot>/CLAUDE.md (claude-code) + <projectRoot>/AGENTS.md (pi).
  // No project.md → both renders are empty → leave the project's files alone.
  for (const { config } of listProjectsSync()) {
    if (!existsSync(config.path)) continue;
    try {
      const claudeManaged = renderProjectLayer(config.path, 'claude-code');
      const piManaged = renderProjectLayer(config.path, 'ohmypi');
      if (!claudeManaged && !piManaged) continue;
      let wrote = false;
      if (claudeManaged) {
        wrote = writeManagedTargetSync(join(config.path, 'CLAUDE.md'), claudeManaged, result, backupTimestamp) || wrote;
      }
      if (piManaged) {
        wrote = writeManagedTargetSync(join(config.path, 'AGENTS.md'), piManaged, result, backupTimestamp) || wrote;
      }
      if (wrote) result.projectsWritten.push(config.name);
    } catch (err: any) {
      result.errors.push(`${config.name}: ${err?.message ?? err}`);
    }
  }

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
export function planHooksSyncSync(): HookItem[] {
  const hooks: HookItem[] = [];

  if (!existsSync(SYNC_SOURCES.hooks)) {
    return hooks;
  }

  // Sync hook scripts (no extension) and bundled JS scripts (.js)
  // Skip source files (.ts), shell helpers (.sh), and other non-hook files (.mjs)
  const scripts = readdirSync(SYNC_SOURCES.hooks, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.')
      && (!entry.name.includes('.') || entry.name.endsWith('.js')));

  for (const script of scripts) {
    const sourcePath = join(SYNC_SOURCES.hooks, script.name);
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
 * Sync hooks (copy scripts to ~/.overdeck/bin/)
 */
export function syncHooksSync(): { synced: string[]; errors: string[] } {
  const result = { synced: [] as string[], errors: [] as string[] };

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true });

  const hooks = planHooksSyncSync();

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
 * Copies the canonical statusline.sh from overdeck scripts to each runtime's config dir
 * and ensures the runtime's settings.json references it.
 */
export function syncStatuslineSync(): { synced: string[]; errors: string[] } {
  const result = { synced: [] as string[], errors: [] as string[] };

  const sourceScript = join(SYNC_SOURCES.hooks, 'statusline.sh');
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
 * overdeck-style project that has a skills/ tree with SKILL.md files.
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

export function mirrorProjectSkillsSync(
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
  // Default: ~/.overdeck/state/mirrors/<escaped-resolvedCwd>/manifest
  // Testable via opts.manifestDir.
  const manifestDir =
    opts?.manifestDir ??
    join(homedir(), '.overdeck', 'state', 'mirrors', resolvedCwd.replace(/[/\\:]/g, '_'));
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

/**
 * Result of syncing the Pi agent settings file.
 *
 * `status` is one of:
 *   - "skipped" — Pi binary not on PATH; we never touch ~/.pi/agent/settings.json
 *   - "created" — settings file did not exist; we wrote a new one
 *   - "updated" — file existed but the skills entry was missing/stale; we merged it
 *   - "unchanged" — file already contained the expected skills entry
 */
export interface PiSettingsSyncResult {
  status: 'skipped' | 'created' | 'updated' | 'unchanged';
  path: string;
  reason?: string;
}

const PI_SKILLS_PATH = join(homedir(), '.claude', 'skills');

function isPiOnPath(): boolean {
  try {
    execSync('which pi', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure ~/.pi/agent/settings.json contains a `skills` array that includes
 * ~/.claude/skills, so Pi reads the same skills tree that Claude Code does
 * (PAN-636 workspace-63b).
 *
 * Idempotent: existing keys outside `skills` are preserved untouched, and an
 * already-correct `skills` entry yields status "unchanged". When Pi is not on
 * PATH the function returns status "skipped" without ever opening the file —
 * we never overwrite user config for a tool they have not installed.
 */
export function syncPiSettingsSync(): PiSettingsSyncResult {
  const settingsPath = join(homedir(), '.pi', 'agent', 'settings.json');

  if (!isPiOnPath()) {
    return { status: 'skipped', path: settingsPath, reason: 'pi not on PATH' };
  }

  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed JSON — leave the file alone rather than risk clobbering user content.
      return { status: 'skipped', path: settingsPath, reason: 'existing settings.json is not valid JSON' };
    }
  }

  const currentSkills = Array.isArray(existing['skills'])
    ? (existing['skills'] as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  const fileExistedBefore = existsSync(settingsPath);
  const alreadyPresent = currentSkills.includes(PI_SKILLS_PATH);
  if (alreadyPresent && fileExistedBefore) {
    return { status: 'unchanged', path: settingsPath };
  }

  const nextSkills = alreadyPresent ? currentSkills : [...currentSkills, PI_SKILLS_PATH];
  const next = { ...existing, skills: nextSkills };

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');

  return {
    status: fileExistedBefore ? 'updated' : 'created',
    path: settingsPath,
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const toSyncFsError = (op: string, cause: unknown): FsError =>
  new FsError({ path: SYNC_TARGET.skills, operation: op, cause });

/** True if `targetPath` is a Overdeck-managed symlink. */
export const isOverdeckSymlink = (
  targetPath: string,
): Effect.Effect<boolean> => Effect.sync(() => isOverdeckSymlinkSync(targetPath));

/** Migrate Overdeck-owned content out of ~/.claude/ (idempotent). */
export const migrateStalePersonalContent = (): Effect.Effect<MigrationResult, FsError> =>
  Effect.try({
    try: () => migrateStalePersonalContentSync(),
    catch: (cause) => toSyncFsError('migrateStalePersonalContent', cause),
  });

/** Remove legacy 0.7.0-era skill directories that were renamed/dropped. */
export const removeLegacySkills070 = (): Effect.Effect<readonly string[], FsError> =>
  Effect.try({
    try: () => removeLegacySkills070Sync(),
    catch: (cause) => toSyncFsError('removeLegacySkills070', cause),
  });

/** Rebuild the sync cache from sources on disk. */
export const refreshCache = (): Effect.Effect<RefreshCacheResult, FsError> =>
  Effect.try({
    try: () => refreshCacheSync(),
    catch: (cause) => toSyncFsError('refreshCache', cause),
  });

/** Compute the plan: which skills, commands, agents, rules need to be synced. */
export const planSync = (): Effect.Effect<SyncPlan, FsError> =>
  Effect.try({
    try: () => planSyncSync(),
    catch: (cause) => toSyncFsError('planSync', cause),
  });

/** Apply the sync plan to ~/.claude/. */
export const executeSync = (options: SyncOptions = {}): Effect.Effect<SyncResult, FsError> =>
  Effect.try({
    try: () => executeSyncSync(options),
    catch: (cause) => toSyncFsError('executeSync', cause),
  });

/** Render the global + project context layers into harness CLAUDE.md files. */
export const syncContextLayers = (): Effect.Effect<ContextLayerSyncResult, FsError> =>
  Effect.try({
    try: () => syncContextLayersSync(),
    catch: (cause) => toSyncFsError('syncContextLayers', cause),
  });

/** Plan hook files to be synced (pure). */
export const planHooksSync = (): Effect.Effect<readonly HookItem[], FsError> =>
  Effect.try({
    try: () => planHooksSyncSync(),
    catch: (cause) => toSyncFsError('planHooksSync', cause),
  });

/** Apply the hook sync plan to ~/.claude/. */
export const syncHooks = (): Effect.Effect<{ synced: string[]; errors: string[] }, FsError> =>
  Effect.try({
    try: () => syncHooksSync(),
    catch: (cause) => toSyncFsError('syncHooks', cause),
  });

/** Mirror the statusline binary into ~/.claude/bin/. */
export const syncStatusline = (): Effect.Effect<{ synced: string[]; errors: string[] }, FsError> =>
  Effect.try({
    try: () => syncStatuslineSync(),
    catch: (cause) => toSyncFsError('syncStatusline', cause),
  });

/** Mirror a project's `skills/` dir into ~/.claude/skills/. */
export const mirrorProjectSkills = (
  cwd: string = process.cwd(),
  opts?: { manifestDir?: string },
): Effect.Effect<SkillsMirrorResult, FsError> =>
  Effect.try({
    try: () => mirrorProjectSkillsSync(cwd, opts),
    catch: (cause) => toSyncFsError('mirrorProjectSkills', cause),
  });

/** Inject the Overdeck skills path into `pi` CLI settings (idempotent). */
export const syncPiSettings = (): Effect.Effect<PiSettingsSyncResult, FsError> =>
  Effect.try({
    try: () => syncPiSettingsSync(),
    catch: (cause) => toSyncFsError('syncPiSettings', cause),
  });

/** Persisted manifest for the startup sync skip-when-unchanged gate. */
export interface SyncManifest {
  hash: string;
  generatedAt: string;
}

/**
 * Compute a deterministic hash of every input that can change the output of
 * `pan sync`. Missing a sync input is treated as an error by the caller so
 * that the conservative fallback is always a full sync.
 *
 * Inputs covered:
 * - The entire SYNC_SOURCES tree (skills, agents, rules, hooks, templates)
 * - ~/.overdeck/context/global.md
 * - Each registered project's .pan/context/project.md
 * - Whether developer mode is active (affects dev-skills selection)
 * - The current working directory (affects project skills mirror)
 */
function computeSyncInputHash(): string {
  const hash = createHash('sha256');

  // Dev mode affects which skills are copied from sync-sources/dev-skills.
  hash.update(String(isDevMode()));

  // mirrorProjectSkillsSync depends on the cwd.
  hash.update(process.cwd());

  // Sync sources tree.
  for (const [key, dir] of Object.entries(SYNC_SOURCES)) {
    if (!existsSync(dir)) {
      throw new Error(`missing sync input: ${key} at ${dir}`);
    }
    updateHashFromDirectory(hash, dir);
  }

  // Global context layer.
  const globalMd = join(OVERDECK_HOME, 'context', 'global.md');
  if (!existsSync(globalMd)) {
    throw new Error('missing global context layer');
  }
  updateHashFromFile(hash, globalMd);

  // Project context layers.
  for (const { config } of listProjectsSync()) {
    const projectMd = join(config.path, '.pan', 'context', 'project.md');
    if (existsSync(projectMd)) {
      updateHashFromFile(hash, projectMd);
    }
  }

  return hash.digest('hex');
}

function updateHashFromDirectory(hash: Hash, dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      updateHashFromDirectory(hash, entryPath);
    } else if (entry.isFile()) {
      updateHashFromFile(hash, entryPath);
    }
  }
}

function updateHashFromFile(hash: Hash, filePath: string): void {
  hash.update(filePath);
  hash.update(readFileSync(filePath));
}

/**
 * Decide whether the startup sync has work to do. Returns `{ needed: false }`
 * only when the persisted manifest at ~/.overdeck/.sync-manifest.json matches
 * the current input hash. Any uncertainty (missing input, unreadable manifest,
 * hash computation error) falls back to `{ needed: true }`.
 */
export function isStartupSyncNeededSync(): { needed: boolean; reason: string } {
  const manifestPath = join(OVERDECK_HOME, '.sync-manifest.json');
  try {
    const currentHash = computeSyncInputHash();
    if (existsSync(manifestPath)) {
      const manifest: SyncManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.hash === currentHash) {
        return { needed: false, reason: 'inputs unchanged' };
      }
    }
    return { needed: true, reason: 'inputs changed or no manifest' };
  } catch (err: unknown) {
    return { needed: true, reason: `hash computation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Write the current sync input hash to ~/.overdeck/.sync-manifest.json.
 * Call after a full sync so the next startup skip gate can succeed.
 */
export function writeSyncManifestSync(): void {
  const manifestPath = join(OVERDECK_HOME, '.sync-manifest.json');
  const hash = computeSyncInputHash();
  writeFileSync(
    manifestPath,
    JSON.stringify({ hash, generatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}
