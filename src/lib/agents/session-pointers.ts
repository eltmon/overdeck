import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { emitAgentEvent } from '../agent-runtime.js';
import { getAgentDir, getAgentStateSync, saveAgentStateSync } from './agent-state.js';

export interface ClearedAgentSessionPointers {
  cleared: string[];
}

/**
 * Clear every mutable pointer that can make a later launch resume an old
 * session. Claude JSONL transcripts live outside the agent directory and are
 * deliberately never touched.
 */
export async function clearAgentSessionPointers(
  agentId: string,
): Promise<ClearedAgentSessionPointers> {
  const agentDir = getAgentDir(agentId);
  const cleared: string[] = [];

  for (const name of ['session.id', 'sessions.json', 'codex-thread-id', 'launcher.sh']) {
    const path = join(agentDir, name);
    if (!existsSync(path)) continue;
    unlinkSync(path);
    cleared.push(name);
  }

  const runtimeFile = join(agentDir, 'runtime.json');
  if (existsSync(runtimeFile)) {
    try {
      const runtime = JSON.parse(readFileSync(runtimeFile, 'utf-8')) as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(runtime, 'claudeSessionId')) {
        delete runtime.claudeSessionId;
        writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2));
        cleared.push('runtime.json:claudeSessionId');
      }
    } catch {
      // A malformed runtime cache must not prevent clearing the durable pointers.
    }
  }

  const state = getAgentStateSync(agentId);
  if (state?.sessionId) {
    delete state.sessionId;
    saveAgentStateSync(state);
    cleared.push('agents.session_id');
  }

  // Clear the live runtime projection too. In the dashboard process this
  // updates the in-memory read model; from the CLI it goes through the runtime
  // heartbeat endpoint. Either way a stale cached id cannot repopulate resume.
  await Effect.runPromise(emitAgentEvent(agentId, {
    kind: 'model_set',
    model: state?.model ?? 'unknown',
    claudeSessionId: null,
  }));
  cleared.push('runtime.claudeSessionId');

  return { cleared };
}
