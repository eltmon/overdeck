import { stat } from 'fs/promises';
import { getDiscoveredSessionBySessionId } from '../overdeck/discovered-sessions.js';

export async function resolveDiscoveredSessionFile(locator: string | null | undefined): Promise<string | null> {
  if (!locator) return null;
  const discovered = getDiscoveredSessionBySessionId(locator);
  if (!discovered?.jsonlPath) return null;
  try {
    await stat(discovered.jsonlPath);
    return discovered.jsonlPath;
  } catch {
    return null;
  }
}
