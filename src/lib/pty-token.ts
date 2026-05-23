import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPanopticonHome } from './paths.js';

export const PTY_TOKEN_HEADER = 'x-panopticon-pty-token';

function ptyTokenDir(agentId: string): string {
  return join(getPanopticonHome(), 'agents', agentId);
}

export function getPtyTokenPath(agentId: string): string {
  return join(ptyTokenDir(agentId), 'pty-token');
}

export function readPtyTokenSync(agentId: string): string | null {
  try {
    const value = readFileSync(getPtyTokenPath(agentId), 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function readPtyToken(agentId: string): Promise<string | null> {
  try {
    const value = (await readFile(getPtyTokenPath(agentId), 'utf8')).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writePtyTokenSync(agentId: string): string {
  const dir = ptyTokenDir(agentId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
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

export async function writePtyToken(agentId: string): Promise<string> {
  const dir = ptyTokenDir(agentId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  const path = getPtyTokenPath(agentId);
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // best effort
  }
  return token;
}
