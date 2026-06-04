/**
 * Terminal drawer types — vendored from t3code (apps/web/src/types.ts, terminal
 * portion) for PAN-1561. Kept verbatim so upstream t3code fixes merge cleanly.
 *
 * Seam vs upstream: t3code brands `ThreadId` via @t3tools/contracts; here it is
 * a plain string (a Panopticon project-deck / conversation key). See PAN-1536
 * for the contract-consolidation follow-up.
 */

/** A terminal "scope" key (Panopticon: the project deck key). */
export type ThreadId = string;

/** Default terminal drawer height in pixels. */
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;

/** Id of the implicit first terminal in a fresh scope. */
export const DEFAULT_THREAD_TERMINAL_ID = "default";

/** Max terminals allowed in a single split group. */
export const MAX_TERMINALS_PER_GROUP = 4;

/** A split group: an ordered set of terminals shown side-by-side. */
export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}
