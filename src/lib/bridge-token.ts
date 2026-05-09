import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { getPanopticonHome } from './paths.js';

export const BRIDGE_TOKEN_HEADER = 'x-panopticon-bridge-token';

function bridgeTokensDir(): string {
  return join(getPanopticonHome(), 'bridge-tokens');
}

export function getBridgeTokenPath(agentId: string): string {
  return join(bridgeTokensDir(), `${agentId}.token`);
}

export function readBridgeToken(agentId: string): string | null {
  const path = getBridgeTokenPath(agentId);
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeBridgeToken(agentId: string): string {
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
