/**
 * One-shot migration from the legacy `sync.devroot` model (PAN-1201).
 *
 * Before PAN-1201, `pan sync` distributed skills/agents/CLAUDE.md out of
 * `<devroot>/.claude/` (devroot defaulting to ~/Projects). The layered model
 * replaces that with `~/.panopticon/context/`. `pan context migrate` lifts
 * the old content across:
 *
 *   <devroot>/.claude/CLAUDE.md  →  ~/.panopticon/context/global.md
 *   <devroot>/.claude/skills/    →  ~/.panopticon/context/global/skills/
 *   <devroot>/.claude/agents/    →  ~/.panopticon/context/global/agents/
 *
 * It never overwrites an existing target (idempotent — safe to re-run) and
 * never deletes the source. The CLI prints the "delete when ready" hint.
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { globalContextFile, globalSkillsDir, globalAgentsDir } from './layers.js';

/** Result of {@link migrateDevroot}. */
export interface DevrootMigrationResult {
  /** Whether a legacy `<devroot>/.claude/` directory was found. */
  detected: boolean;
  /** The legacy `.claude` directory inspected. */
  oldClaudeDir: string;
  /** Human-readable descriptions of content copied to the new location. */
  copied: string[];
  /** Descriptions of content skipped because the target already existed. */
  skipped: string[];
  /** Candidate project directories discovered under the projects root. */
  discoveredProjects: string[];
}

/** Options for {@link migrateDevroot} (overridable for tests). */
export interface DevrootMigrationOptions {
  /** Legacy `.claude` dir. Default: `~/Projects/.claude`. */
  oldClaudeDir?: string;
  /** Root scanned for projects to register. Default: `~/Projects`. */
  projectsRoot?: string;
}

/** Copy a tree, never overwriting an existing destination file. */
function copyTreeIfAbsent(srcDir: string, dstDir: string): { copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;
  if (!existsSync(srcDir)) return { copied, skipped };
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const sub = copyTreeIfAbsent(src, dst);
      copied += sub.copied;
      skipped += sub.skipped;
    } else if (entry.isFile()) {
      if (existsSync(dst)) {
        skipped++;
      } else {
        copyFileSync(src, dst);
        copied++;
      }
    }
  }
  return { copied, skipped };
}

/** Discover immediate subdirectories of `root` that look like git projects. */
export function discoverProjects(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, '.git'))) found.push(dir);
  }
  return found.sort();
}

/**
 * Migrate legacy devroot content into the layered context model.
 *
 * Pure of side effects beyond the copies described above — does not register
 * projects (the CLI does that interactively) and does not delete the source.
 */
export function migrateDevroot(options: DevrootMigrationOptions = {}): DevrootMigrationResult {
  const oldClaudeDir = options.oldClaudeDir ?? join(homedir(), 'Projects', '.claude');
  const projectsRoot = options.projectsRoot ?? join(homedir(), 'Projects');

  const result: DevrootMigrationResult = {
    detected: existsSync(oldClaudeDir),
    oldClaudeDir,
    copied: [],
    skipped: [],
    discoveredProjects: discoverProjects(projectsRoot),
  };

  if (!result.detected) return result;

  // 1. CLAUDE.md → global.md (no-overwrite).
  const oldClaudeMd = join(oldClaudeDir, 'CLAUDE.md');
  const newGlobalMd = globalContextFile();
  if (existsSync(oldClaudeMd) && statSync(oldClaudeMd).isFile()) {
    if (existsSync(newGlobalMd)) {
      result.skipped.push(`global.md (target exists: ${newGlobalMd})`);
    } else {
      mkdirSync(join(newGlobalMd, '..'), { recursive: true });
      copyFileSync(oldClaudeMd, newGlobalMd);
      result.copied.push(`CLAUDE.md → ${newGlobalMd}`);
    }
  }

  // 2. skills/ and agents/ → global/{skills,agents}/ (no-overwrite per file).
  for (const [sub, dst] of [
    ['skills', globalSkillsDir()],
    ['agents', globalAgentsDir()],
  ] as const) {
    const srcDir = join(oldClaudeDir, sub);
    if (!existsSync(srcDir)) continue;
    const { copied, skipped } = copyTreeIfAbsent(srcDir, dst);
    if (copied > 0) result.copied.push(`${sub}/ → ${dst} (${copied} file(s))`);
    if (skipped > 0) result.skipped.push(`${sub}/ (${skipped} file(s) already present)`);
  }

  return result;
}
