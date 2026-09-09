/** Explicit first-user-message context transport for the native Kimi CLI. */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { claudeSystemPromptFiles } from '../context-layers/launch-sources.js';
import { getOverdeckHome } from '../paths.js';

export const KIMI_CONTEXT_START = '<overdeck-managed-context version="1">';
export const KIMI_CONTEXT_END = '</overdeck-managed-context>';
export const KIMI_TASK_START = '<overdeck-user-task>';
export const KIMI_TASK_END = '</overdeck-user-task>';

interface KimiContextReceipt {
  version: 1;
  sessions: Record<string, { deliveredAt: string; sha256: string }>;
}

export interface PreparedKimiMessage {
  message: string;
  sessionId: string;
  contextIncluded: boolean;
  contextSha256?: string;
  overdeckHome: string;
}

function receiptPath(agentId: string, overdeckHome = getOverdeckHome()): string {
  return join(overdeckHome, 'agents', agentId, 'kimi-context-delivery.json');
}

function readReceipt(agentId: string, overdeckHome = getOverdeckHome()): KimiContextReceipt {
  try {
    const parsed = JSON.parse(readFileSync(receiptPath(agentId, overdeckHome), 'utf8')) as KimiContextReceipt;
    if (parsed.version === 1 && parsed.sessions && typeof parsed.sessions === 'object') return parsed;
  } catch { /* no valid receipt yet */ }
  return { version: 1, sessions: {} };
}

export function readManagedKimiSessionId(agentId: string, overdeckHome = getOverdeckHome()): string | null {
  try {
    return readFileSync(join(overdeckHome, 'agents', agentId, 'kimi-session-id'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Pure formatter: context first, original task afterward, with hard delimiters. */
export function buildKimiContextEnvelope(contextFiles: readonly string[], taskMessage: string): {
  message: string;
  sha256: string;
} {
  const sections = contextFiles.flatMap((file) => {
    const content = readFileSync(file, 'utf8').trim();
    return content ? [`## Context source: ${file}\n\n${content}`] : [];
  });
  if (sections.length === 0) {
    throw new Error('Managed Kimi launch blocked: required launch context was empty or unreadable.');
  }
  const context = sections.join('\n\n---\n\n');
  const sha256 = createHash('sha256').update(context).digest('hex');
  const envelope = [
    KIMI_CONTEXT_START,
    'Treat this delimited block as managed launch context for this session. Apply it throughout the session.',
    '',
    context,
    KIMI_CONTEXT_END,
  ];
  if (taskMessage.length > 0) {
    envelope.push('', KIMI_TASK_START, taskMessage, KIMI_TASK_END);
  }
  return { message: envelope.join('\n'), sha256 };
}

/**
 * Add context only if this exact native Kimi session has not received it.
 * A resume/recovery of the same session therefore keeps task messages clean;
 * a fresh session receives the envelope on its first visible user message.
 */
export async function prepareKimiMessage(
  agentId: string,
  workspace: string,
  taskMessage: string,
  options: { sessionId?: string; contextFiles?: string[]; overdeckHome?: string } = {},
): Promise<PreparedKimiMessage> {
  const overdeckHome = options.overdeckHome ?? getOverdeckHome();
  const sessionId = options.sessionId ?? readManagedKimiSessionId(agentId, overdeckHome);
  if (!sessionId) {
    throw new Error(`Managed Kimi message blocked for ${agentId}: captured kimi-session-id is missing.`);
  }
  if (readReceipt(agentId, overdeckHome).sessions[sessionId]) {
    return { message: taskMessage, sessionId, contextIncluded: false, overdeckHome };
  }
  const contextFiles = options.contextFiles ?? await claudeSystemPromptFiles(workspace, 'kimi-code');
  const envelope = buildKimiContextEnvelope(contextFiles, taskMessage);
  return {
    message: envelope.message,
    sessionId,
    contextIncluded: true,
    contextSha256: envelope.sha256,
    overdeckHome,
  };
}

/** Persist only after the envelope delivery returned success. */
export function markKimiContextDelivered(agentId: string, prepared: PreparedKimiMessage): void {
  if (!prepared.contextIncluded || !prepared.contextSha256) return;
  const path = receiptPath(agentId, prepared.overdeckHome);
  const receipt = readReceipt(agentId, prepared.overdeckHome);
  if (receipt.sessions[prepared.sessionId]?.sha256 === prepared.contextSha256) return;
  receipt.sessions[prepared.sessionId] = {
    deliveredAt: new Date().toISOString(),
    sha256: prepared.contextSha256,
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
