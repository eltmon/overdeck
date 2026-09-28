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
    return [`if ! PAN_SKILL_SETTINGS="$(${command})"; then ${WARNING}; PAN_SKILL_SETTINGS=''; fi`];
  }
  return [`${command} --codex-home "$CODEX_HOME" || ${WARNING}`];
}

/** The Claude command suffix that passes the resolved settings, when the step was emitted. */
export function claudeSkillSettingsArg(emitted: boolean): string {
  return emitted ? ' ${PAN_SKILL_SETTINGS:+--settings "$PAN_SKILL_SETTINGS"}' : '';
}
