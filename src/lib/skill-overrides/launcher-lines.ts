/**
 * Launcher bash for skill overrides (PAN-3942). A leaf module: the launcher
 * generator imports it, so it must not reach the override store (circular ESM
 * through settings-api). `./launch.ts` holds the resolution that the emitted
 * `pan skills launch-settings` step runs.
 */
import { shellQuote } from '../shell-quote.js';

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
    // A zero exit with stray stdout (an update notice, a banner) must not reach
    // `claude --settings`: keep only empty output or one JSON object.
    return [
      `if ! PAN_SKILL_SETTINGS="$(${command})"; then ${WARNING}; PAN_SKILL_SETTINGS=''; fi`,
      `case "$PAN_SKILL_SETTINGS" in ''|'{'*'}') ;; *) ${WARNING}; PAN_SKILL_SETTINGS='' ;; esac`,
    ];
  }
  return [`${command} --codex-home "$CODEX_HOME" || ${WARNING}`];
}

/** The Claude command suffix that passes the resolved settings, when the step was emitted. */
export function claudeSkillSettingsArg(emitted: boolean): string {
  return emitted ? ' ${PAN_SKILL_SETTINGS:+--settings "$PAN_SKILL_SETTINGS"}' : '';
}

/** The LauncherConfig fields that decide whether and how a launch applies skill overrides. */
export interface SkillOverrideLaunchConfig {
  harness?: string;
  spawnMode?: string;
  workingDir: string;
  codexHome?: string;
  overdeckEnv?: { issueId?: string };
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
  return {
    config: config.baseCommand ? { ...config, baseCommand: config.baseCommand + claudeSkillSettingsArg(true) } : config,
    lines: launcherSkillOverrideLines({ harness: 'claude-code', workingDir: config.workingDir, issueId: config.overdeckEnv?.issueId }),
  };
}

/** Codex: the step that writes the per-agent config block; it needs CODEX_HOME exported first. */
export function codexSkillOverrideLines(config: SkillOverrideLaunchConfig): string[] {
  if (!appliesTo(config, 'codex') || !config.codexHome) return [];
  return launcherSkillOverrideLines({ harness: 'codex', workingDir: config.workingDir, issueId: config.overdeckEnv?.issueId });
}
