import { homedir } from 'os';
import { join, sep } from 'path';
import { existsSync } from 'fs';

// Overdeck home directory (can be overridden for testing)
export const OVERDECK_HOME = process.env.OVERDECK_HOME || join(homedir(), '.panopticon');

/** Get OVERDECK_HOME dynamically (reads env var on each call, useful for testing) */
export function getOverdeckHome(): string {
  return process.env.OVERDECK_HOME || join(homedir(), '.panopticon');
}

// Subdirectories
export const CONFIG_DIR = OVERDECK_HOME;
export const SKILLS_DIR = join(OVERDECK_HOME, 'skills');
export const COMMANDS_DIR = join(OVERDECK_HOME, 'commands');
export const AGENTS_DIR = join(OVERDECK_HOME, 'agents');
export const BIN_DIR = join(OVERDECK_HOME, 'bin');
export const BACKUPS_DIR = join(OVERDECK_HOME, 'backups');
export const COSTS_DIR = join(OVERDECK_HOME, 'costs');
export const HEARTBEATS_DIR = join(OVERDECK_HOME, 'heartbeats');
export const ARCHIVES_DIR = join(OVERDECK_HOME, 'archives');
export const LOGS_DIR = join(OVERDECK_HOME, 'logs');
export const HANDOFFS_DIR = join(OVERDECK_HOME, 'handoffs');

export function getHandoffsDir(): string {
  return join(getOverdeckHome(), 'handoffs');
}

// Traefik directories
export const TRAEFIK_DIR = join(OVERDECK_HOME, 'traefik');
export const TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, 'dynamic');
export const TRAEFIK_CERTS_DIR = join(TRAEFIK_DIR, 'certs');

// Legacy certs directory (for backwards compatibility)
export const CERTS_DIR = join(OVERDECK_HOME, 'certs');

// Config files
export const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');
export const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json');

// AI tool directory (Claude Code is the sole supported runtime)
export const CLAUDE_DIR = join(homedir(), '.claude');

// Legacy runtime directories (kept for symlink cleanup migration)
export const LEGACY_RUNTIME_DIRS = {
  codex: join(homedir(), '.codex'),
  cursor: join(homedir(), '.cursor'),
  gemini: join(homedir(), '.gemini'),
  opencode: join(homedir(), '.opencode'),
} as const;

// Sync target (Claude Code only)
export const SYNC_TARGET = {
  skills: join(CLAUDE_DIR, 'skills'),
  commands: join(CLAUDE_DIR, 'commands'),
  agents: join(CLAUDE_DIR, 'agents'),
} as const;

// Templates directory (in user's ~/.panopticon)
export const TEMPLATES_DIR = join(OVERDECK_HOME, 'templates');
export const CLAUDE_MD_TEMPLATES = join(TEMPLATES_DIR, 'claude-md', 'sections');

// Source templates directory (bundled with the package)
// This is resolved at runtime from the package root
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

export function resolvePackageRootForDir(dir: string): string {
  const srcSegment = `${sep}src${sep}`;
  const distSegment = `${sep}dist`;
  const nestedDistSegment = `${distSegment}${sep}`;

  if (dir.includes(srcSegment)) {
    return dir.slice(0, dir.indexOf(srcSegment));
  }
  if (dir.endsWith(distSegment)) {
    return dirname(dir);
  }
  if (dir.includes(nestedDistSegment)) {
    return dir.slice(0, dir.indexOf(nestedDistSegment));
  }
  return dir.endsWith(`${sep}lib`) ? dirname(dirname(dir)) : dirname(dir);
}

export const packageRoot = resolvePackageRootForDir(currentDir);

/**
 * Root of Overdeck's own bundled sync sources (PAN-1201).
 *
 * Everything `pan sync` distributes from the package itself lives under this
 * single explicit top-level directory — skills, dev-skills, agents, rules,
 * hook scripts, and workspace templates. A glance at the repo root shows
 * exactly what sync distributes.
 *
 * This replaces the scattered SOURCE_*_DIR constants that previously pointed
 * at sprawled top-level dirs. That sprawl let the stale top-level `rules/`
 * silently rot while the maintained rules accumulated elsewhere (#1359):
 * nothing in the repo layout signalled which dirs were sync sources.
 */
export const SYNC_SOURCES_ROOT = join(packageRoot, 'sync-sources');

/** Resolved sub-paths under {@link SYNC_SOURCES_ROOT}. */
export const SYNC_SOURCES = {
  root: SYNC_SOURCES_ROOT,
  skills: join(SYNC_SOURCES_ROOT, 'skills'),
  devSkills: join(SYNC_SOURCES_ROOT, 'dev-skills'),
  agents: join(SYNC_SOURCES_ROOT, 'agents'),
  rules: join(SYNC_SOURCES_ROOT, 'rules'),
  hooks: join(SYNC_SOURCES_ROOT, 'hooks'),
  gitHooks: join(SYNC_SOURCES_ROOT, 'hooks', 'git-hooks'),
  templates: join(SYNC_SOURCES_ROOT, 'templates'),
  traefikTemplates: join(SYNC_SOURCES_ROOT, 'templates', 'traefik'),
  claudeMdSections: join(SYNC_SOURCES_ROOT, 'templates', 'claude-md', 'sections'),
} as const;

// Cache directories (where Overdeck keeps its copy of distributed content)
export const CACHE_SKILLS_DIR = SKILLS_DIR;   // ~/.panopticon/skills/
export const CACHE_AGENTS_DIR = join(OVERDECK_HOME, 'agent-definitions');  // separate from agent state
export const CACHE_RULES_DIR = join(OVERDECK_HOME, 'rules');
export const CACHE_MANIFEST = join(OVERDECK_HOME, '.manifest.json');

// Pre-workspace PRD directory and docs RAG state directory
export const DOCS_DIR = join(OVERDECK_HOME, 'docs');
export const PRDS_DIR = join(DOCS_DIR, 'prds');
export const PRD_DRAFTS_DIR = join(PRDS_DIR, 'drafts');
export const PRD_PUBLISHED_DIR = join(PRDS_DIR, 'published');
export const DOCS_INDEX_FILE = join(DOCS_DIR, 'index.sqlite');
export const DOCS_BUDGET_STATE_FILE = join(DOCS_DIR, 'budget-state.json');
export const DOCS_DISABLE_STATE_FILE = join(DOCS_DIR, 'disable-state.json');
export const DOCS_TELEMETRY_FILE = join(DOCS_DIR, 'telemetry.jsonl');

export interface DocsPathOverrides {
  panopticonHome?: string;
  docsDir?: string;
  indexPath?: string;
  budgetStatePath?: string;
  disableStatePath?: string;
  telemetryPath?: string;
}

export interface DocsPaths {
  docsDir: string;
  indexPath: string;
  budgetStatePath: string;
  disableStatePath: string;
  telemetryPath: string;
}

export function getDocsPaths(overrides: DocsPathOverrides = {}): DocsPaths {
  const docsDir = overrides.docsDir ?? join(overrides.panopticonHome ?? getOverdeckHome(), 'docs');
  return {
    docsDir,
    indexPath: overrides.indexPath ?? join(docsDir, 'index.sqlite'),
    budgetStatePath: overrides.budgetStatePath ?? join(docsDir, 'budget-state.json'),
    disableStatePath: overrides.disableStatePath ?? join(docsDir, 'disable-state.json'),
    telemetryPath: overrides.telemetryPath ?? join(docsDir, 'telemetry.jsonl'),
  };
}

export function getDocsDir(overrides: Pick<DocsPathOverrides, 'panopticonHome' | 'docsDir'> = {}): string {
  return getDocsPaths(overrides).docsDir;
}

export function getDocsIndexPath(overrides: Pick<DocsPathOverrides, 'panopticonHome' | 'docsDir' | 'indexPath'> = {}): string {
  return getDocsPaths(overrides).indexPath;
}

export function getDocsBudgetStatePath(overrides: Pick<DocsPathOverrides, 'panopticonHome' | 'docsDir' | 'budgetStatePath'> = {}): string {
  return getDocsPaths(overrides).budgetStatePath;
}

export function getDocsDisableStatePath(overrides: Pick<DocsPathOverrides, 'panopticonHome' | 'docsDir' | 'disableStatePath'> = {}): string {
  return getDocsPaths(overrides).disableStatePath;
}

export function getDocsTelemetryPath(overrides: Pick<DocsPathOverrides, 'panopticonHome' | 'docsDir' | 'telemetryPath'> = {}): string {
  return getDocsPaths(overrides).telemetryPath;
}

// Project-relative docs paths (subdirectory names for project-level docs)
export const PROJECT_DOCS_SUBDIR = 'docs';
export const PROJECT_PRDS_SUBDIR = 'prds';
export const PROJECT_PRDS_ACTIVE_SUBDIR = 'active';
export const PROJECT_PRDS_PLANNED_SUBDIR = 'planned';
export const PROJECT_PRDS_COMPLETED_SUBDIR = 'completed';

/**
 * Detect if running from a overdeck checkout (vs an installed package).
 *
 * The npm package ships only `dist/` plus the dirs in package.json's `files`
 * array — never `src/`. So the presence of a `src/` directory next to the
 * resolved package root is a reliable dev-mode signal.
 *
 * (PAN-1201: previously keyed off the bundled `dev-skills/` dir. That broke
 * once dev-skills moved under the shipped `sync-sources/` tree — the package
 * now ships dev-skills, so their presence no longer implies a checkout.)
 */
export function isDevMode(): boolean {
  return existsSync(join(packageRoot, 'src'));
}

/**
 * Encode a filesystem path to match Claude Code's project directory naming.
 *
 * Claude Code replaces ALL non-alphanumeric characters (except hyphens) with
 * hyphens when encoding the CWD into the project directory name under
 * ~/.claude/projects/. For example:
 *
 *   /Users/edward.becker/Projects → -Users-edward-becker-Projects
 *   /home/eltmon/Projects         → -home-eltmon-Projects
 *   /tmp/test_under.dot+plus@at   → -tmp-test-under-dot-plus-at
 *
 * This is critical for session file lookup — a mismatch means JSONL files
 * are never found and conversation messages appear permanently empty.
 */
export function encodeClaudeProjectDir(cwdPath: string): string {
  return cwdPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Compute the deterministic JSONL session file path from cwd + session UUID.
 *
 * Claude Code stores session files at:
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 */
export function sessionFilePath(cwd: string, sessionId: string): string {
  const encodedCwd = encodeClaudeProjectDir(cwd);
  return join(homedir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
}

/** Extract the session UUID from a full JSONL file path. */
export function sessionIdFromFile(sessionFile: string | null | undefined): string | undefined {
  if (!sessionFile) return undefined;
  return sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined;
}

// All directories to create on init
export const INIT_DIRS = [
  OVERDECK_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  BIN_DIR,
  BACKUPS_DIR,
  COSTS_DIR,
  HEARTBEATS_DIR,
  TEMPLATES_DIR,
  CLAUDE_MD_TEMPLATES,
  CERTS_DIR,
  CACHE_AGENTS_DIR,
  CACHE_RULES_DIR,
  TRAEFIK_DIR,
  TRAEFIK_DYNAMIC_DIR,
  TRAEFIK_CERTS_DIR,
  DOCS_DIR,
  PRDS_DIR,
  PRD_DRAFTS_DIR,
  PRD_PUBLISHED_DIR,
];
