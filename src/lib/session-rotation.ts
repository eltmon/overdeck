/**
 * PAN-1980: session rotation on resume policy.
 *
 * Work agents used to rotate to a brand-new Claude session (a fresh JSONL
 * transcript) when a resume couldn't reuse the saved one — compact/overflow
 * recovery (PAN-1781), model/harness drift (PAN-1787/1797), or the messageAgent
 * resume-failure fresh-launch fallback. That rotation broke the conversation
 * panel (it pinned to a stale transcript while the terminal showed the live one)
 * and mostly papered over non-Anthropic CLIProxy overflow that native claude-code
 * handles in-place.
 *
 * Rotation is now DISABLED: a resume that would need a fresh session errors and
 * stops the agent for a human instead. Flip {@link ALLOW_SESSION_ROTATION_ON_RESUME}
 * to `true` to restore the old behavior; the intended replacement is in-place
 * `/compact` into the SAME session (the deacon already does this for
 * specialist/planning sessions).
 */
export const ALLOW_SESSION_ROTATION_ON_RESUME = false;

/**
 * Whether a resume that would otherwise rotate to a fresh session must be
 * REFUSED. A resume needs a fresh session when it is a compact-recovery respawn
 * (`compactSeed` present) or the saved session drifted (model/harness). With
 * rotation disabled we refuse rather than rotate.
 */
export function sessionRotationRefused(opts: {
  compactSeed: boolean;
  driftReasons: readonly string[];
}): boolean {
  const wouldRotate = opts.compactSeed || opts.driftReasons.length > 0;
  return wouldRotate && !ALLOW_SESSION_ROTATION_ON_RESUME;
}
