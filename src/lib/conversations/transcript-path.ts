import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { claudeProjectsRoot, sessionFilePath } from '../runtimes/storage/claude-code.js';

export type ConversationTranscriptStatus = 'ok' | 'expired' | 'unknown';

export interface ConversationTranscriptResolution {
  path: string | null;
  status: ConversationTranscriptStatus;
}

export function resolveConversationTranscript(
  cwd: string | null | undefined,
  claudeSessionId: string | null | undefined,
): ConversationTranscriptResolution {
  if (!claudeSessionId) return { path: null, status: 'unknown' };

  const derived = sessionFilePath(cwd ?? '', claudeSessionId);
  if (existsSync(derived)) return { path: derived, status: 'ok' };

  const fallback = findClaudeProjectSessionFile(claudeSessionId);
  if (fallback) return { path: fallback, status: 'ok' };

  return { path: derived, status: 'expired' };
}

function findClaudeProjectSessionFile(sessionId: string): string | null {
  const projectsDir = claudeProjectsRoot();
  if (!existsSync(projectsDir)) return null;

  for (const projectDir of readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const candidate = join(projectsDir, projectDir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}
