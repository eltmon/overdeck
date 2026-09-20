import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  agentDir: '',
  state: null as { sessionId?: string; model?: string } | null,
  saveAgentStateSync: vi.fn(),
  emitAgentEvent: vi.fn(),
}));

vi.mock('../agent-state.js', () => ({
  getAgentDir: () => mocks.agentDir,
  getAgentStateSync: () => mocks.state,
  saveAgentStateSync: mocks.saveAgentStateSync,
}));

vi.mock('../../agent-runtime.js', () => ({
  emitAgentEvent: mocks.emitAgentEvent,
}));

import { isSessionResetMarker } from '../../session-history.js';
import { clearAgentSessionPointers } from '../session-pointers.js';

describe('clearAgentSessionPointers', () => {
  let root: string;
  let prevOverdeckHome: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'overdeck-session-pointers-'));
    prevOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = root;
    mocks.agentDir = join(root, 'agents', 'agent-pan-2895-review');
    mocks.state = { sessionId: 'dead-session', model: 'claude-sonnet-4-6' };
    mocks.emitAgentEvent.mockReturnValue(Effect.succeed(true));
    mkdirSync(mocks.agentDir, { recursive: true });
  });

  afterEach(() => {
    if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevOverdeckHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('clears indexed and legacy session pointers without touching transcripts', async () => {
    for (const name of ['session.id', 'sessions.json', 'codex-thread-id', 'launcher.sh']) {
      writeFileSync(join(mocks.agentDir, name), name === 'launcher.sh' ? "claude --resume 'dead-session'\n" : 'dead-session');
    }
    writeFileSync(join(mocks.agentDir, 'runtime.json'), JSON.stringify({
      claudeSessionId: 'dead-session',
      state: 'stopped',
    }));
    const transcript = join(root, 'dead-session.jsonl');
    writeFileSync(transcript, '{"type":"user"}\n');

    await clearAgentSessionPointers('agent-pan-2895-review');

    for (const name of ['session.id', 'codex-thread-id', 'launcher.sh']) {
      expect(existsSync(join(mocks.agentDir, name))).toBe(false);
    }
    expect(readFileSync(join(mocks.agentDir, 'sessions.json'), 'utf8')).toContain('"reset":true');
    expect(isSessionResetMarker('agent-pan-2895-review')).toBe(true);
    expect(JSON.parse(readFileSync(join(mocks.agentDir, 'runtime.json'), 'utf-8'))).toEqual({ state: 'stopped' });
    expect(mocks.state?.sessionId).toBeUndefined();
    expect(mocks.saveAgentStateSync).toHaveBeenCalledWith(mocks.state);
    expect(mocks.emitAgentEvent).toHaveBeenCalledWith(
      'agent-pan-2895-review',
      {
        kind: 'model_set',
        model: 'claude-sonnet-4-6',
        claudeSessionId: null,
      },
    );
    expect(readFileSync(transcript, 'utf-8')).toBe('{"type":"user"}\n');
  });
});
