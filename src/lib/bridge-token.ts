import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';
import { FsError } from './errors.js';

import { getPanopticonHome } from './paths.js';

export const BRIDGE_TOKEN_HEADER = 'x-panopticon-bridge-token';

function bridgeTokensDir(): string {
  return join(getPanopticonHome(), 'bridge-tokens');
}

export function getBridgeTokenPath(agentId: string): string {
  return join(bridgeTokensDir(), `${agentId}.token`);
}

export function readBridgeTokenSync(agentId: string): string | null {
  const path = getBridgeTokenPath(agentId);
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeBridgeTokenSync(agentId: string): string {
  const dir = bridgeTokensDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const token = randomBytes(32).toString('hex');
  const path = getBridgeTokenPath(agentId);
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort
  }
  return token;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Read the bridge token for an agent. Returns `null` if no token exists.
 * Effect-native variant — never fails (errors are swallowed to null like the Promise version).
 */
export const readBridgeToken = (agentId: string): Effect.Effect<string | null> =>
  Effect.sync(() => readBridgeTokenSync(agentId));

/**
 * Generate and persist a new bridge token. Returns the new token.
 * Effect-native variant — fails with FsError if the write cannot be persisted.
 */
export const writeBridgeToken = (agentId: string): Effect.Effect<string, FsError> =>
  Effect.try({
    try: () => writeBridgeTokenSync(agentId),
    catch: (cause) =>
      new FsError({
        path: getBridgeTokenPath(agentId),
        operation: 'writeBridgeToken',
        cause,
      }),
  });
