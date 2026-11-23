import { describe, expect, it } from 'vitest';

import { CLAUDE_TRUST_DIALOG_BACKSTOP } from '../../../../tests/fixtures/claude-trust-dialog.js';
import { appendPaneDetectionKind } from '../../agent-enrichment.js';
import type { PendingInputKind } from '../../agent-enrichment.js';
import { detectStartupStall, STARTUP_TRANSCRIPT_GRACE_MS, type StartupStallDeps } from '../startup-stall.js';

/**
 * PAN-4242: a Claude Code agent that, three minutes after launch, has written
 * no transcript and shows a blocking menu is reported as waiting on input.
 */

const STARTED_AT = '2026-11-23T08:00:00.000Z';
const STARTED_MS = Date.parse(STARTED_AT);

function deps(overrides: Partial<StartupStallDeps> = {}): StartupStallDeps {
  return {
    now: () => STARTED_MS + 181_000,
    harness: () => 'claude-code',
    transcriptMtime: async () => null,
    readPane: async () => CLAUDE_TRUST_DIALOG_BACKSTOP,
    ...overrides,
  };
}

describe('detectStartupStall (PAN-4242)', () => {
  it('reports a Claude Code agent stalled at the trust dialog', async () => {
    const detection = await detectStartupStall('agent-x', STARTED_AT, deps());

    expect(detection?.reason).toBe('startup_blocked');
    expect(detection?.prompt).toContain('no transcript 3 min after launch');
    expect(detection?.prompt).toContain('Accessing workspace:');
    expect(detection?.prompt).toContain('1. No, continue without these permissions');
    expect(detection?.prompt).toContain('2. Yes, I trust this folder');
    expect(detection?.prompt).toContain('pan answer agent-x <number>');
  });

  it('treats an agent with no recorded harness as Claude Code', async () => {
    const detection = await detectStartupStall('agent-x', STARTED_AT, deps({ harness: () => undefined }));

    expect(detection?.reason).toBe('startup_blocked');
  });

  it('waits out the grace period', async () => {
    const detection = await detectStartupStall('agent-x', STARTED_AT, deps({
      now: () => STARTED_MS + STARTUP_TRANSCRIPT_GRACE_MS - 1_000,
    }));

    expect(detection).toBeNull();
  });

  it('ignores an agent whose transcript was written since launch', async () => {
    expect(await detectStartupStall('agent-x', STARTED_AT, deps({ transcriptMtime: async () => STARTED_MS }))).toBeNull();
  });

  it('still flags an agent whose only transcript is older than its launch', async () => {
    const detection = await detectStartupStall('agent-x', STARTED_AT, deps({ transcriptMtime: async () => STARTED_MS - 1 }));

    expect(detection?.reason).toBe('startup_blocked');
  });

  it('ignores other harnesses', async () => {
    expect(await detectStartupStall('agent-x', STARTED_AT, deps({ harness: () => 'codex' }))).toBeNull();
  });

  it('ignores a pane with no menu', async () => {
    expect(await detectStartupStall('agent-x', STARTED_AT, deps({ readPane: async () => '❯ \n' }))).toBeNull();
  });

  it('ignores a pane that cannot be read', async () => {
    const detection = await detectStartupStall('agent-x', STARTED_AT, deps({
      readPane: async () => { throw new Error('herdr holds no pane for agent-x'); },
    }));

    expect(detection).toBeNull();
  });

  it('ignores an agent with no parseable start time', async () => {
    expect(await detectStartupStall('agent-x', undefined, deps())).toBeNull();
  });

  it('is surfaced as a pane question', () => {
    const kinds: PendingInputKind[] = [];

    appendPaneDetectionKind({ reason: 'startup_blocked', prompt: 'x' }, kinds);

    expect(kinds).toContain('paneQuestion');
  });
});
