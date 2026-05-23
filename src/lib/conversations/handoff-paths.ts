import { mkdir } from 'fs/promises';
import { join } from 'path';
import { getHandoffsDir } from '../paths.js';

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface HandoffPaths {
  docPath: string;
  sentinelPath: string;
}

export function createHandoffPaths(sourceConvId: string, isoTimestamp: string): HandoffPaths {
  const convId = sourceConvId.trim();
  const timestamp = isoTimestamp.trim();

  if (!SAFE_PATH_SEGMENT.test(convId)) {
    throw new Error(`Invalid handoff conversation id: ${sourceConvId}`);
  }
  if (timestamp.length === 0 || timestamp.includes('/') || timestamp.includes('\\')) {
    throw new Error(`Invalid handoff timestamp: ${isoTimestamp}`);
  }

  const docPath = join(getHandoffsDir(), `${convId}-${timestamp}.md`);
  return {
    docPath,
    sentinelPath: `${docPath}.done`,
  };
}

export async function ensureHandoffsDir(): Promise<string> {
  const handoffsDir = getHandoffsDir();
  await mkdir(handoffsDir, { recursive: true });
  return handoffsDir;
}
