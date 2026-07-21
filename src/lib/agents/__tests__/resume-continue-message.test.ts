import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildResumeContinueMessage } from '../supervisor-channels.js';

/**
 * PAN-2974 root cause B: the resume kickoff is phase-aware. A handed-off
 * agent (completed marker, agent dir or workspace) gets a PASSIVE restore —
 * never "pick up where you left off — do not wait for further instructions",
 * which made a post-reboot resume re-drive the pipeline on finished work
 * (2026-07-21 MIN-882).
 */
let tempHome: string;
let tempWorkspace: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-2974-home-'));
  tempWorkspace = mkdtempSync(join(tmpdir(), 'pan-2974-ws-'));
  prevHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempWorkspace, { recursive: true, force: true });
});

function state(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-min-882',
    issueId: 'MIN-882',
    workspace: tempWorkspace,
    role: 'work',
    status: 'stopped',
    ...overrides,
  } as never;
}

describe('buildResumeContinueMessage (PAN-2974 — phase-aware kickoff)', () => {
  it('gives a PASSIVE restore when the agent dir carries a completed marker', () => {
    const dir = join(tempHome, 'agents', 'agent-min-882');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'completed'), 'done');

    const message = buildResumeContinueMessage(state());

    expect(message).toContain('restored after a restart');
    expect(message).toContain('Do NOT re-drive pipeline stages');
    expect(message).not.toContain('pick up where you left off');
  });

  it('gives a PASSIVE restore when the workspace carries a completed marker', () => {
    mkdirSync(join(tempWorkspace, '.pan'), { recursive: true });
    writeFileSync(join(tempWorkspace, '.pan', 'completed.processed'), 'done');

    const message = buildResumeContinueMessage(state());

    expect(message).toContain('restored after a restart');
    expect(message).toContain('Do NOT re-drive pipeline stages');
    expect(message).not.toContain('pick up where you left off');
  });

  it('keeps the aggressive kickoff for a mid-implementation agent (no marker)', () => {
    const message = buildResumeContinueMessage(state());

    expect(message).toContain('pick up where you left off');
    expect(message).toContain('do not wait for further instructions');
    expect(message).not.toContain('Do NOT re-drive pipeline stages');
  });
});
