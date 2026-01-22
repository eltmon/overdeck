import { homedir } from 'os';
import { join } from 'path';

// Panopticon home directory (can be overridden for testing)
export const PANOPTICON_HOME = process.env.PANOPTICON_HOME || join(homedir(), '.panopticon');

// Subdirectories
export const CONFIG_DIR = PANOPTICON_HOME;
export const SKILLS_DIR = join(PANOPTICON_HOME, 'skills');
export const COMMANDS_DIR = join(PANOPTICON_HOME, 'commands');
export const AGENTS_DIR = join(PANOPTICON_HOME, 'agents');
export const BACKUPS_DIR = join(PANOPTICON_HOME, 'backups');
export const COSTS_DIR = join(PANOPTICON_HOME, 'costs');

// Traefik directories
export const TRAEFIK_DIR = join(PANOPTICON_HOME, 'traefik');
export const TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, 'dynamic');
export const TRAEFIK_CERTS_DIR = join(TRAEFIK_DIR, 'certs');

// Legacy certs directory (for backwards compatibility)
export const CERTS_DIR = join(PANOPTICON_HOME, 'certs');

// Config files
export const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');

// AI tool directories
export const CLAUDE_DIR = join(homedir(), '.claude');
export const CODEX_DIR = join(homedir(), '.codex');
export const CURSOR_DIR = join(homedir(), '.cursor');
export const GEMINI_DIR = join(homedir(), '.gemini');

// Target sync locations
export const SYNC_TARGETS = {
  claude: {
    skills: join(CLAUDE_DIR, 'skills'),
    commands: join(CLAUDE_DIR, 'commands'),
    agents: join(CLAUDE_DIR, 'agents'),
  },
  codex: {
    skills: join(CODEX_DIR, 'skills'),
    commands: join(CODEX_DIR, 'commands'),
    agents: join(CODEX_DIR, 'agents'),
  },
  cursor: {
    skills: join(CURSOR_DIR, 'skills'),
    commands: join(CURSOR_DIR, 'commands'),
    agents: join(CURSOR_DIR, 'agents'),
  },
  gemini: {
    skills: join(GEMINI_DIR, 'skills'),
    commands: join(GEMINI_DIR, 'commands'),
    agents: join(GEMINI_DIR, 'agents'),
  },
} as const;

export type Runtime = keyof typeof SYNC_TARGETS;

// Templates directory (in user's ~/.panopticon)
export const TEMPLATES_DIR = join(PANOPTICON_HOME, 'templates');
export const CLAUDE_MD_TEMPLATES = join(TEMPLATES_DIR, 'claude-md', 'sections');

// Source templates directory (bundled with the package)
// This is resolved at runtime from the package root
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentFile = fileURLToPath(import.meta.url);
const distDir = dirname(currentFile); // dist/ or dist/lib/ depending on bundler
const packageRoot = dirname(distDir);  // package root

export const SOURCE_TEMPLATES_DIR = join(packageRoot, 'templates');
export const SOURCE_TRAEFIK_TEMPLATES = join(SOURCE_TEMPLATES_DIR, 'traefik');

// All directories to create on init
export const INIT_DIRS = [
  PANOPTICON_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  BACKUPS_DIR,
  COSTS_DIR,
  TEMPLATES_DIR,
  CLAUDE_MD_TEMPLATES,
  CERTS_DIR,
  TRAEFIK_DIR,
  TRAEFIK_DYNAMIC_DIR,
  TRAEFIK_CERTS_DIR,
];
