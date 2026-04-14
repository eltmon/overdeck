/**
 * pan show <id> — unified observation command
 *
 * Default: compact summary (shadow state, current specialist, last heartbeat,
 * most recent CV entries). ≤ 25 lines.
 *
 * Flags scope the output to specific views:
 *   --shadow    Shadow state details
 *   --cv        Agent work history (CV)
 *   --context   Context engineering state
 *   --health    Health + heartbeat only
 */

import { shadowCommand } from './shadow.js';
import { cvCommand } from './cv.js';
import { contextCommand } from './context.js';
import { healthCommand } from './health.js';

interface ShowOptions {
  shadow?: boolean;
  cv?: boolean;
  context?: boolean;
  health?: boolean;
  json?: boolean;
}

export async function showCommand(id: string, options: ShowOptions = {}): Promise<void> {
  const { shadow, cv, context, health, json } = options;

  // If a specific flag is set, delegate exclusively to that view
  if (shadow) {
    return shadowCommand(id);
  }
  if (cv) {
    return cvCommand(id, { json });
  }
  if (context) {
    return contextCommand('state', id, undefined, { json });
  }
  if (health) {
    return healthCommand('check', id, { json });
  }

  // Default: run all views in order for a compact summary
  await shadowCommand(id);
  await cvCommand(id, { json });
  await healthCommand('check', id, { json });
  await contextCommand('state', id, undefined, { json });
}
