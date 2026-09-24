import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClaudeCodeRuntime } from '../claude-code.js';

// PAN-3948: the deacon child has no runtime mirror, so liveness.ts `isIdle`
// depends entirely on this runtime's transcript heartbeat. The heartbeat must
// find the transcript through the path recorded in the agent's sessions.json,
// because the legacy sessions-index.json lookup finds nothing on current hosts.
describe('ClaudeCodeRuntime transcript resolution', () => {
  let root: string;
  const agentId = 'planning-pan-3948-test';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-3948-session-path-'));
    vi.stubEnv('OVERDECK_HOME', join(root, 'overdeck'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the transcript path recorded in sessions.json and dates the heartbeat from it', () => {
    const transcript = join(root, 'projects', 'ws', 'session-1.jsonl');
    mkdirSync(join(root, 'projects', 'ws'), { recursive: true });
    writeFileSync(transcript, '{"type":"assistant"}\n');
    const mtime = new Date('2026-09-21T22:05:39.000Z');
    utimesSync(transcript, mtime, mtime);

    const agentDir = join(root, 'overdeck', 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'sessions.json'),
      `${JSON.stringify({ sessionId: 'session-1', at: '2026-09-21T18:00:00-04:00', source: 'heartbeat-hook', harness: 'claude-code', path: transcript })}\n`,
    );

    const runtime = createClaudeCodeRuntime();

    expect(runtime.getSessionPath(agentId)).toBe(transcript);
    const heartbeat = runtime.getHeartbeat(agentId);
    expect(heartbeat?.source).toBe('jsonl');
    expect(heartbeat?.timestamp.getTime()).toBe(mtime.getTime());
  });
});
