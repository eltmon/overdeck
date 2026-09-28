/**
 * Apply skill overrides to a managed launch (PAN-3942).
 *
 * The launcher runs `pan skills launch-settings` before the harness starts.
 * Claude Code gets `--settings '{"skillOverrides":{...:"off"}}'`; Codex gets
 * `[[skills.config]] enabled = false` blocks in the per-agent config.toml.
 * Both hide skills by name, so every copy of a skill hides.
 *
 * Import boundary: launcher-generator.ts imports this module for its pure
 * string builders, so only fs/path/shell-quote load statically. The store and
 * project resolution load lazily inside resolveLaunchDisabledSkills.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shellQuote } from '../shell-quote.js';

export interface LaunchSkillContext {
  cwd: string;
  issueId?: string;
}

export const CODEX_SKILL_BLOCK_BEGIN = '# overdeck:skill-overrides:begin';
export const CODEX_SKILL_BLOCK_END = '# overdeck:skill-overrides:end';

/** Skill names the launch should hide: issue from ctx or the workspace path, project from the cwd. */
export async function resolveLaunchDisabledSkills(ctx: LaunchSkillContext): Promise<string[]> {
  const [{ loadSkillOverrideLayers }, { disabledSkillNames }, { resolveProjectKeyForCwdAsync }, { issueIdFromWorkspacePath }] =
    await Promise.all([
      import('./store.js'),
      import('./resolve.js'),
      import('../projects.js'),
      import('../xbrief/io.js'),
    ]);
  const issueId = ctx.issueId ?? issueIdFromWorkspacePath(ctx.cwd) ?? undefined;
  const projectKey = (await resolveProjectKeyForCwdAsync(ctx.cwd)) ?? undefined;
  return disabledSkillNames(await loadSkillOverrideLayers({ projectKey, issueId }));
}

/** The `--settings` JSON for Claude Code, or '' when nothing is hidden. */
export function claudeSkillSettingsJson(disabled: readonly string[]): string {
  if (disabled.length === 0) return '';
  return JSON.stringify({ skillOverrides: Object.fromEntries(disabled.map(name => [name, 'off'])) });
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripSkillBlock(content: string): string {
  const begin = content.indexOf(CODEX_SKILL_BLOCK_BEGIN);
  if (begin === -1) return content;
  const end = content.indexOf(CODEX_SKILL_BLOCK_END, begin);
  const after = end === -1 ? content.length : end + CODEX_SKILL_BLOCK_END.length;
  return stripSkillBlock(content.slice(0, begin) + content.slice(after));
}

/** Replace the managed skill block in `<codexHome>/config.toml`. Idempotent. */
export async function writeCodexSkillOverrides(codexHome: string, disabled: readonly string[]): Promise<void> {
  const path = join(codexHome, 'config.toml');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const base = stripSkillBlock(existing).trimEnd();
  const block = disabled.length === 0 ? '' : [
    CODEX_SKILL_BLOCK_BEGIN,
    ...disabled.flatMap(name => ['[[skills.config]]', `name = "${escapeTomlBasicString(name)}"`, 'enabled = false']),
    CODEX_SKILL_BLOCK_END,
  ].join('\n');
  const next = [base, block].filter(Boolean).join('\n\n');
  await mkdir(codexHome, { recursive: true });
  await writeFile(path, next ? `${next}\n` : '', { mode: 0o600 });
  await chmod(path, 0o600);
}

const WARNING = `echo "[launcher] WARNING: skill overrides not applied" >&2`;

/** Bash for the launcher step that resolves overrides before the harness starts. */
export function launcherSkillOverrideLines(opts: {
  harness: 'claude-code' | 'codex';
  workingDir: string;
  issueId?: string;
}): string[] {
  const args = [`--harness ${opts.harness}`, `--cwd ${shellQuote(opts.workingDir)}`];
  if (opts.issueId) args.push(`--issue ${shellQuote(opts.issueId)}`);
  const command = `pan skills launch-settings ${args.join(' ')}`;
  if (opts.harness === 'claude-code') {
    return [`if ! PAN_SKILL_SETTINGS="$(${command})"; then ${WARNING}; PAN_SKILL_SETTINGS=''; fi`];
  }
  return [`${command} --codex-home "$CODEX_HOME" || ${WARNING}`];
}

/** The Claude command suffix that passes the resolved settings, when the step was emitted. */
export function claudeSkillSettingsArg(emitted: boolean): string {
  return emitted ? ' ${PAN_SKILL_SETTINGS:+--settings "$PAN_SKILL_SETTINGS"}' : '';
}
