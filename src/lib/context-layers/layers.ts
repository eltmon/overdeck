/**
 * Context layer model (PAN-1201).
 *
 * Three layers of context compose at sync time:
 *
 *   global    — ~/.panopticon/context/global.md  (+ global/{skills,agents}/)
 *               Applies to every harness invocation, everywhere.
 *   project   — <projectRoot>/.pan/context/project.md
 *               Applies when CWD is under a registered project. Committed.
 *   workspace — <workspace>/.pan/context/workspace.md
 *               Auto-assembled by Panopticon at spawn time. Gitignored.
 *
 * The global layer lives under ~/.panopticon (per-machine). Project and
 * workspace layers live under the repo's `.pan/` dir — the convention
 * PAN-967 unified everything else under — not the legacy `.panopticon/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getPanopticonHome } from '../paths.js';

/** The three context layers, outermost to innermost. */
export type ContextLayerKind = 'global' | 'project' | 'workspace';

export const CONTEXT_LAYER_KINDS: readonly ContextLayerKind[] = ['global', 'project', 'workspace'];

/** A context layer's canonical markdown file and its on-disk presence. */
export interface ContextLayer {
  kind: ContextLayerKind;
  /** Absolute path to the layer's canonical markdown file. */
  file: string;
  /** Absolute path to the layer's directory (holds the .md + skills/agents). */
  dir: string;
  exists: boolean;
}

// ─── Path resolution ──────────────────────────────────────────────────────

/** `~/.panopticon/context` — the global layer directory. */
export function globalContextDir(): string {
  return join(getPanopticonHome(), 'context');
}

/** `~/.panopticon/context/global.md` — the global layer's canonical source. */
export function globalContextFile(): string {
  return join(globalContextDir(), 'global.md');
}

/** `~/.panopticon/context/global/skills` — user skills in the global layer. */
export function globalSkillsDir(): string {
  return join(globalContextDir(), 'global', 'skills');
}

/** `~/.panopticon/context/global/agents` — user agents in the global layer. */
export function globalAgentsDir(): string {
  return join(globalContextDir(), 'global', 'agents');
}

/** `<projectRoot>/.pan/context` — a registered project's layer directory. */
export function projectContextDir(projectRoot: string): string {
  return join(projectRoot, '.pan', 'context');
}

/** `<projectRoot>/.pan/context/project.md` — a project's canonical source. */
export function projectContextFile(projectRoot: string): string {
  return join(projectContextDir(projectRoot), 'project.md');
}

/** `<workspace>/.pan/context` — a workspace's layer directory. */
export function workspaceContextDir(workspacePath: string): string {
  return join(workspacePath, '.pan', 'context');
}

/** `<workspace>/.pan/context/workspace.md` — the auto-assembled bundle. */
export function workspaceContextFile(workspacePath: string): string {
  return join(workspaceContextDir(workspacePath), 'workspace.md');
}

// ─── Starter templates ────────────────────────────────────────────────────

/** Seeded into `global.md` by `pan install` / first `pan sync`. */
export const GLOBAL_STARTER = `# Global Context

This file is the single canonical source for context that applies to every
coding-agent session on this machine. \`pan sync\` renders it into each
harness's home (e.g. ~/.claude/CLAUDE.md) — edit it here, not there.

Harness-specific guidance goes in a templating block:

{{#harness:claude}}
Guidance only Claude Code sees.
{{/harness:claude}}

{{#harness:pi}}
Guidance only Pi sees.
{{/harness:pi}}

Anything outside a block applies to every harness.
`;

/** Seeded into a project's `project.md` when it is registered. */
export const PROJECT_STARTER = `# Project Context

Context for this project specifically. \`pan sync\` renders it into the
project's CLAUDE.md (and equivalents) when CWD is under this project.

This file is committed to the repo; \`workspace.md\` is not.
`;

// ─── Layer introspection ──────────────────────────────────────────────────

/** Describe the global layer's on-disk state. */
export function globalLayer(): ContextLayer {
  const file = globalContextFile();
  return { kind: 'global', file, dir: globalContextDir(), exists: existsSync(file) };
}

/** Describe a project layer's on-disk state. */
export function projectLayer(projectRoot: string): ContextLayer {
  const file = projectContextFile(projectRoot);
  return { kind: 'project', file, dir: projectContextDir(projectRoot), exists: existsSync(file) };
}

/** Describe a workspace layer's on-disk state. */
export function workspaceLayer(workspacePath: string): ContextLayer {
  const file = workspaceContextFile(workspacePath);
  return {
    kind: 'workspace',
    file,
    dir: workspaceContextDir(workspacePath),
    exists: existsSync(file),
  };
}

/**
 * Ensure the global layer exists, seeding `global.md` with a starter when
 * absent. Idempotent — never overwrites existing content. Returns true when
 * a file was created.
 */
export function ensureGlobalLayer(): boolean {
  const file = globalContextFile();
  if (existsSync(file)) return false;
  mkdirSync(globalContextDir(), { recursive: true });
  writeFileSync(file, GLOBAL_STARTER, 'utf-8');
  return true;
}

/**
 * Ensure a project's layer dir exists with a stub `project.md`. Idempotent.
 * Returns true when a file was created. Called by `pan projects add`.
 */
export function ensureProjectLayer(projectRoot: string): boolean {
  const file = projectContextFile(projectRoot);
  if (existsSync(file)) return false;
  mkdirSync(projectContextDir(projectRoot), { recursive: true });
  writeFileSync(file, PROJECT_STARTER, 'utf-8');
  return true;
}

/** Read a layer's canonical markdown, or '' when the file does not exist. */
export function readLayerContent(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf-8') : '';
}
