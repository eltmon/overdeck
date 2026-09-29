/**
 * Launcher bash for skill overrides (PAN-3942). A leaf module: the launcher
 * generator imports it, so it must not reach the override store (circular ESM
 * through settings-api). `./launch.ts` holds the resolution that the emitted
 * `pan skills launch-settings` step runs.
 *
 * Skill packs (PAN-4334): the same step points a per-launch plugin link at the
 * pack mount, and the Claude command passes it as `--plugin-dir` when it is a
 * directory. The link lives at `<OVERDECK_HOME>/launch/<launchKey>/skill-packs`.
 */
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import { shellQuote } from '../shell-quote.js';

const WARNING = `echo "[launcher] WARNING: skill overrides not applied" >&2`;

/** Bash for the launcher step that resolves overrides before the harness starts. */
export function launcherSkillOverrideLines(opts: {
  harness: 'claude-code' | 'codex';
  workingDir: string;
  issueId?: string;
  pluginLink?: string;
}): string[] {
  const args = [`--harness ${opts.harness}`, `--cwd ${shellQuote(opts.workingDir)}`];
  if (opts.issueId) args.push(`--issue ${shellQuote(opts.issueId)}`);
  const link = opts.harness === 'claude-code' && opts.pluginLink ? shellQuote(opts.pluginLink) : undefined;
  if (link) args.push(`--plugin-link ${link}`);
  const command = `pan skills launch-settings ${args.join(' ')}`;
  if (opts.harness === 'claude-code') {
    // A zero exit with stray stdout (an update notice, a banner) must not reach
    // `claude --settings`: keep only empty output or one JSON object.
    const lines = [
      `if ! PAN_SKILL_SETTINGS="$(${command})"; then ${WARNING}; PAN_SKILL_SETTINGS=''; fi`,
      `case "$PAN_SKILL_SETTINGS" in ''|'{'*'}') ;; *) ${WARNING}; PAN_SKILL_SETTINGS='' ;; esac`,
    ];
    if (link) lines.push(`if [ -d ${link} ]; then PAN_SKILL_PLUGIN_DIR=${link}; else PAN_SKILL_PLUGIN_DIR=''; fi`);
    return lines;
  }
  return [`${command} --codex-home "$CODEX_HOME" || ${WARNING}`];
}

/** The Claude command suffix that passes the resolved settings, when the step was emitted. */
export function claudeSkillSettingsArg(emitted: boolean): string {
  return emitted ? ' ${PAN_SKILL_SETTINGS:+--settings "$PAN_SKILL_SETTINGS"}' : '';
}

/** The Claude command suffix that passes the skill pack plugin dir, when the link step was emitted. */
export function claudeSkillPluginDirArg(emitted: boolean): string {
  return emitted ? ' ${PAN_SKILL_PLUGIN_DIR:+--plugin-dir "$PAN_SKILL_PLUGIN_DIR"}' : '';
}

/** The LauncherConfig fields that decide whether and how a launch applies skill overrides. */
export interface SkillOverrideLaunchConfig {
  harness?: string;
  spawnMode?: string;
  workingDir: string;
  codexHome?: string;
  managedStateKey?: string;
  sessionId?: string;
  overdeckEnv?: { issueId?: string; agentId?: string };
}

const LAUNCH_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * PD-2: the per-launch plugin link, keyed like the launcher's managed state
 * (`managedStateKey ?? agentId ?? sessionId`). No usable key ⇒ no link, so
 * the launch runs without packs.
 */
export function skillPackLinkPath(config: SkillOverrideLaunchConfig): string | undefined {
  const key = config.managedStateKey ?? config.overdeckEnv?.agentId ?? config.sessionId;
  if (!key || !LAUNCH_KEY_PATTERN.test(key) || key === '.' || key === '..') return undefined;
  return join(getOverdeckHome(), 'launch', key, 'skill-packs');
}

/** Local launches of the harness apply overrides; remote (Fly) launches do not. */
function appliesTo(config: SkillOverrideLaunchConfig, harness: 'claude-code' | 'codex'): boolean {
  return config.spawnMode !== 'remote' && (config.harness ?? 'claude-code') === harness;
}

/**
 * Claude Code: the resolve step, and a base command that passes the resolved
 * settings. Both Claude command shapes start from `baseCommand`.
 */
export function claudeSkillOverrideLaunch<T extends SkillOverrideLaunchConfig & { baseCommand?: string }>(
  config: T,
): { config: T; lines: string[] } {
  if (!appliesTo(config, 'claude-code')) return { config, lines: [] };
  const link = skillPackLinkPath(config);
  const suffix = claudeSkillSettingsArg(true) + claudeSkillPluginDirArg(link !== undefined);
  return {
    config: config.baseCommand ? { ...config, baseCommand: config.baseCommand + suffix } : config,
    lines: launcherSkillOverrideLines({
      harness: 'claude-code',
      workingDir: config.workingDir,
      issueId: config.overdeckEnv?.issueId,
      pluginLink: link,
    }),
  };
}

/** Codex: the step that writes the per-agent config block; it needs CODEX_HOME exported first. */
export function codexSkillOverrideLines(config: SkillOverrideLaunchConfig): string[] {
  if (!appliesTo(config, 'codex') || !config.codexHome) return [];
  return launcherSkillOverrideLines({ harness: 'codex', workingDir: config.workingDir, issueId: config.overdeckEnv?.issueId });
}
