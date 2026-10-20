import { resolveEffectiveLauncher } from './conversations.js';

/** PAN-4565: a fresh start never has a handoff document, so its title comes
 * straight from the focus — never from the parent's title, and never
 * prefixed "Handoff:" like a normal handoff fork.
 */
export function freshStartTitle(focus: string | undefined): string {
  const f = focus?.replace(/\s+/g, ' ').trim();
  if (!f) return 'New conversation';
  return f.length > 70 ? `${f.slice(0, 69).trimEnd()}…` : f;
}

/**
 * PAN-4565 FR-9: a fresh start has no parent link, so a gauntlet lane
 * conversation or any of its successors cannot be its source — that would
 * silently drop the lane standing (run/key/role) the lane only carries
 * through the parent link (PAN-4223 D21).
 */
export function freshStartLaneRefusal(sourceName: string): string | null {
  const launcher = resolveEffectiveLauncher(sourceName);
  if (!launcher || launcher.laneKey === null) return null;
  return 'a fresh start cannot be made from a gauntlet lane or its successors: it would drop the lane standing that passes through the parent link (PAN-4223 D21). Use pan handoff without --fresh, or pan lane start --reuse.';
}
