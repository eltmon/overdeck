import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const FLYWHEEL_STATE_RELATIVE_PATH = 'docs/FLYWHEEL-STATE.md';

export interface FlywheelStateReadOptions {
  projectRoot?: string;
}

export interface FlywheelStatePayload {
  exists: boolean;
  path: string;
  content: string | null;
  lastModified: string | null;
}

function resolveStatePath(projectRoot: string): string {
  const root = resolve(projectRoot);
  const absolute = resolve(root, FLYWHEEL_STATE_RELATIVE_PATH);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Flywheel state path escapes the project root');
  }
  return absolute;
}

export async function readFlywheelState(options: FlywheelStateReadOptions = {}): Promise<FlywheelStatePayload> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const absolute = resolveStatePath(projectRoot);
  const displayPath = join(FLYWHEEL_STATE_RELATIVE_PATH);
  try {
    const [content, info] = await Promise.all([
      readFile(absolute, 'utf8'),
      stat(absolute),
    ]);
    return {
      exists: true,
      path: displayPath,
      content,
      lastModified: info.mtime.toISOString(),
    };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') {
      return { exists: false, path: displayPath, content: null, lastModified: null };
    }
    throw error;
  }
}
