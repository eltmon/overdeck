import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the default cwd used when no project is selected — the "devroot"
 * fallback. Prefers `~/Projects` if it exists, otherwise the user's home
 * directory.
 *
 * Replaces the deprecated `sync.devroot` config (PAN-1201) for the runtime
 * code paths that still need a sensible default working directory:
 *
 * - New conversations created without a `projectKey` (conversations.ts)
 * - The global editor-launcher in the dashboard top bar (PanOpenInPicker)
 */
export function getDefaultCwd(): string {
  const candidate = join(homedir(), 'Projects');
  return existsSync(candidate) ? candidate : homedir();
}
