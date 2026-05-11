import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

// Panopticon home directory (can be overridden for testing)
export const PANOPTICON_HOME = process.env.PANOPTICON_HOME || join(homedir(), '.panopticon');

/** Get PANOPTICON_HOME dynamically (reads env var on each call, useful for testing) */
export function getPanopticonHome(): string {
  return process.env.PANOPTICON_HOME || join(homedir(), '.panopticon');
}

// Subdirectories
export const CONFIG_DIR = PANOPTICON_HOME;
export const SKILLS_DIR = join(PANOPTICON_HOME, 'skills');
export const COMMANDS_DIR = join(PANOPTICON_HOME, 'commands');
export const AGENTS_DIR = join(PANOPTICON_HOME, 'agents');
export const BIN_DIR = join(PANOPTICON_HOME, 'bin');
export const BACKUPS_DIR = join(PANOPTICON_HOME, 'backups');
export const COSTS_DIR = join(PANOPTICON_HOME, 'costs');
export const HEARTBEATS_DIR = join(PANOPTICON_HOME, 'heartbeats');
export const ARCHIVES_DIR = join(PANOPTICON_HOME, 'archives');
export const LOGS_DIR = join(PANOPTICON_HOME, 'logs');

// Traefik directories
export const TRAEFIK_DIR = join(PANOPTICON_HOME, 'traefik');
export const TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, 'dynamic');
export const TRAEFIK_CERTS_DIR = join(TRAEFIK_DIR, 'certs');

// Legacy certs directory (for backwards compatibility)
export const CERTS_DIR = join(PANOPTICON_HOME, 'certs');

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
export const TEMPLATES_DIR = join(PANOPTICON_HOME, 'templates');
export const CLAUDE_MD_TEMPLATES = join(TEMPLATES_DIR, 'claude-md', 'sections');

// Source templates directory (bundled with the package)
// This is resolved at runtime from the package root
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

// Handle both development (src/lib/) and production (dist/) modes
// In dev: /path/to/panopticon/src/lib/paths.ts -> /path/to/panopticon
// In prod: /path/to/panopticon/dist/lib/paths.js -> /path/to/panopticon
export let packageRoot: string;
if (currentDir.includes('/src/')) {
  // Development mode - go up from src/lib to package root
  packageRoot = dirname(dirname(currentDir));
} else {
  // Production mode - go up from dist (or dist/lib) to package root
  packageRoot = currentDir.endsWith('/lib')
    ? dirname(dirname(currentDir))
    : dirname(currentDir);
}

export const SOURCE_TEMPLATES_DIR = join(packageRoot, 'templates');
export const SOURCE_TRAEFIK_TEMPLATES = join(SOURCE_TEMPLATES_DIR, 'traefik');
export const SOURCE_SCRIPTS_DIR = join(packageRoot, 'scripts');
export const SOURCE_SKILLS_DIR = join(packageRoot, 'skills');
export const SOURCE_DEV_SKILLS_DIR = join(packageRoot, 'dev-skills');
export const SOURCE_AGENTS_DIR = join(packageRoot, 'agents');
export const SOURCE_RULES_DIR = join(packageRoot, 'rules');

// Cache directories (where Panopticon keeps its copy of distributed content)
export const CACHE_SKILLS_DIR = SKILLS_DIR;   // ~/.panopticon/skills/
export const CACHE_AGENTS_DIR = join(PANOPTICON_HOME, 'agent-definitions');  // separate from agent state
export const CACHE_RULES_DIR = join(PANOPTICON_HOME, 'rules');
export const CACHE_MANIFEST = join(PANOPTICON_HOME, '.manifest.json');

// Pre-workspace PRD directory (for PRDs created before workspace exists)
export const DOCS_DIR = join(PANOPTICON_HOME, 'docs');
export const PRDS_DIR = join(DOCS_DIR, 'prds');
export const PRD_DRAFTS_DIR = join(PRDS_DIR, 'drafts');
export const PRD_PUBLISHED_DIR = join(PRDS_DIR, 'published');

// Project-relative docs paths (subdirectory names for project-level docs)
export const PROJECT_DOCS_SUBDIR = 'docs';
export const PROJECT_PRDS_SUBDIR = 'prds';
export const PROJECT_PRDS_ACTIVE_SUBDIR = 'active';
export const PROJECT_PRDS_PLANNED_SUBDIR = 'planned';
export const PROJECT_PRDS_COMPLETED_SUBDIR = 'completed';

/**
 * Detect if running in development mode (from npm link or panopticon repo)
 *
 * Dev mode is detected if:
 * 1. Running from the panopticon source directory (npm link)
 * 2. The SOURCE_DEV_SKILLS_DIR exists (only present in repo, not in npm package)
 */
export function isDevMode(): boolean {
  try {
    // Check if dev-skills directory exists - this is only in the repo, not npm package
    return existsSync(SOURCE_DEV_SKILLS_DIR);
  } catch {
    return false;
  }
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
  PANOPTICON_HOME,
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
