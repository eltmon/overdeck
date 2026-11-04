/**
 * Boot order for the link supervisor (PAN-5046 FR-9, D-6). A link that comes online during boot runs
 * the linked syncs, which fetch through the link client; if the status, presence and route sources
 * were still unset they failed with "Machine links are not running on this dashboard". So the sources
 * are wired first and the supervisor starts after. A leaf module, so its test does not load the boot.
 */

/** Wires the link sources, then starts the supervisor, so a link that comes online during boot finds them. */
export function startLinkSupervisorWired<S extends { start(): void }>(supervisor: S, wire: ReadonlyArray<(source: S) => void>): void {
  for (const set of wire) set(supervisor);
  supervisor.start();
}
