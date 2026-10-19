/**
 * The harness lines of a generated launcher, with job control for claude-code.
 *
 * Herdr must detect a claude-code pane (`detectionPolicyFor`), and it looks
 * for an agent only when the pane's foreground process group changes. A
 * launcher is a non-interactive bash script with no job control, so the
 * harness stays in the launcher's group; a harness that starts after the
 * launcher's setup work (`pan skills launch-settings` alone takes ~0.8 s) is
 * never detected (PAN-4564).
 *
 * `set -m` runs the harness as its own foreground group. `exec` keeps the
 * launcher's group, so an exec line becomes a child plus `exit $?`, which
 * still ends the launcher when the harness ends. A PTY-supervisor launch
 * hides the harness from Herdr either way, so it keeps `exec`. Other harnesses
 * do not need Herdr detection and are returned unchanged.
 */
export function harnessLaunchLines(
  config: { harness?: string; useSupervisor?: boolean },
  commandParts: readonly string[],
): string[] {
  if (commandParts.length === 0) return [];
  if ((config.harness ?? 'claude-code') !== 'claude-code') return [...commandParts];
  const lines = ['set -m'];
  for (const part of commandParts) {
    if (part.startsWith('exec ') && !config.useSupervisor) lines.push(part.slice('exec '.length), 'exit $?');
    else lines.push(part);
  }
  return lines;
}
