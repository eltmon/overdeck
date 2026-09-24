/**
 * Terminal backend registry (PAN-3917 FR-3).
 *
 * Adapters register themselves at import time (`src/lib/terminal-backends/herdr.ts`,
 * `tmux.ts`). Callers resolve by name; resolving a name nothing registered is a
 * programming error and throws with the import that is missing.
 */

import type { TerminalBackend, TerminalBackendName } from './types.js';

const backends = new Map<TerminalBackendName, TerminalBackend>();

/** Register an adapter. Called at module load by each adapter. */
export function registerTerminalBackend(backend: TerminalBackend): void {
  backends.set(backend.name, backend);
}

/** The adapter registered under `name`. Throws when its module was never imported. */
export function resolveTerminalBackend(name: TerminalBackendName): TerminalBackend {
  const backend = backends.get(name);
  if (!backend) {
    throw new Error(
      `No terminal backend registered for '${name}'. ` +
      `Import src/lib/terminal-backends/${name}.js before resolving it.`,
    );
  }
  return backend;
}
