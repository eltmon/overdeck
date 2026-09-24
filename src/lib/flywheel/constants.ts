/**
 * Shared flywheel names (PAN-3964). The CLI, the dashboard server, and the
 * frontend all name the same conversation; none of them names a run.
 */

/** The one flywheel conversation. A second one would be a second orchestrator. */
export const FLYWHEEL_CONVERSATION_SESSION = 'conv-flywheel';

/** The skill the conversation runs. */
export const FLYWHEEL_SKILL_COMMAND = '/pan-flywheel';

/** Freshness thresholds for the last tick (v1 `getLastTickFreshness`). */
export const FLYWHEEL_FRESHNESS_LIVE_MS = 60_000;
export const FLYWHEEL_FRESHNESS_BREATHING_MS = 20 * 60_000;
