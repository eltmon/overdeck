import { randomUUID } from 'crypto';
import { rename, writeFile } from 'fs/promises';
import type { PendingTurn } from '@panctl/contracts';
import { ensureDir, resolvePendingDir } from './paths.js';

export interface WritePendingTurnResult {
  path: string;
  fileName: string;
}

export async function writePendingTurn(turn: PendingTurn): Promise<WritePendingTurnResult> {
  const dir = resolvePendingDir(turn.identity.projectId, turn.identity.issueId);
  await ensureDir(dir);

  const fileName = pendingTurnFileName(turn);
  const path = `${dir}/${fileName}`;
  const tempPath = `${dir}/.${fileName}.${process.pid}.${randomUUID()}.tmp`;

  await writeFile(tempPath, `${JSON.stringify(turn, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);

  return { path, fileName };
}

export function pendingTurnFileName(turn: Pick<PendingTurn, 'createdAt' | 'identity'>): string {
  const millis = new Date(turn.createdAt).getTime();
  return `${millis}_${safeFileSegment(turn.identity.sessionId)}.json`;
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
