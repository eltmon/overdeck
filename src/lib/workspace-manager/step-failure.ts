/**
 * PAN-5489: turn a setup helper's step lines into the workspace-creation error.
 *
 * `createHumeConfig` and `addTunnelIngress` report what went wrong in their
 * `steps`, which most callers never print. The error text carries the lines
 * that explain the failure: the ones that say `failed` or `not found`
 * (case-insensitive), or else the last line.
 */

/** The step lines that explain a failed setup step, joined with '; '. */
export function failingStepLines(steps: readonly string[]): string {
  const failed = steps.filter((line) => /\b(failed|not found)\b/i.test(line));
  const lines = failed.length > 0 ? failed : steps.slice(-1);
  return lines.join('; ');
}

/** `<label> failed: <failing lines>`, or `<label> failed` when there are no lines. */
export function setupStepError(label: string, steps: readonly string[]): string {
  const detail = failingStepLines(steps);
  return detail ? `${label} failed: ${detail}` : `${label} failed`;
}
