import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { FsError } from './errors.js';
import { getPanopticonHome } from './paths.js';

export const PTY_TOKEN_HEADER = 'x-panopticon-pty-token';

function ptyTokenDir(agentId: string): string {
  return join(getPanopticonHome(), 'agents', agentId);
}

export function getPtyTokenPath(agentId: string): string {
  return join(ptyTokenDir(agentId), 'pty-token');
}

export function readPtyTokenSync(agentId: string): string | null {
  const path = getPtyTokenPath(agentId);
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writePtyTokenSync(agentId: string): string {
  const dir = ptyTokenDir(agentId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const token = randomBytes(32).toString('hex');
  const path = getPtyTokenPath(agentId);
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort
  }
  return token;
}

export const readPtyToken = (agentId: string): Effect.Effect<string | null> =>
  Effect.sync(() => readPtyTokenSync(agentId));

export const writePtyToken = (agentId: string): Effect.Effect<string, FsError> =>
  Effect.try({
    try: () => writePtyTokenSync(agentId),
    catch: (cause) =>
      new FsError({
        path: getPtyTokenPath(agentId),
        operation: 'writePtyToken',
        cause,
      }),
  });
