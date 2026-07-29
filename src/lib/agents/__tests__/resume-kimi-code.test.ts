/**
 * PAN-1837 review fix (cycle 5, P1): resumeAgent() must actually resume a
 * native Kimi Code work agent — pass its captured session id through as
 * `-S <id>` and deliver the continue message via the native readiness path,
 * not fall through to the Claude-only SessionStart-hook + transcript-JSONL
 * branch (which always times out for Kimi and silently reported "resumed").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/kimi/bin/kimi', pathExport: "export PATH='/opt/kimi/bin':\"$PATH\"" })),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false, supervisorScriptPath: undefined })),
  resolveHarness: vi.fn(async () => 'kimi-code'),
  deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'supervisor' })),
  deliverResumeMessageWithTranscriptConfirmation: vi.fn(async () => ({ delivered: true, attempts: 1 })),
  killSession: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../spawn-prep.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spawn-prep.js')>();
  return {
    ...actual,
    assertWorkspaceStackHealthyForSpawn: mocks.assertWorkspaceStackHealthyForSpawn,
  };
});

vi.mock('../../harness-binary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness-binary.js')>();
  return {
    ...actual,
    prepareHarnessLaunch: mocks.prepareHarnessLaunch,
  };
});

vi.mock('../supervisor-channels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor-channels.js')>();
  return {
    ...actual,
    prepareSupervisorForRelaunch: mocks.prepareSupervisorForRelaunch,
  };
});

vi.mock('../../harness-resolve.js', () => ({
  resolveHarness: mocks.resolveHarness,
}));

vi.mock('../delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../delivery.js')>();
  return {
    ...actual,
    deliverInitialPromptWithRetry: mocks.deliverInitialPromptWithRetry,
    deliverResumeMessageWithTranscriptConfirmation: mocks.deliverResumeMessageWithTranscriptConfirmation,
  };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return {
    ...actual,
    createSession: vi.fn(() => Effect.succeed(undefined)),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    killSession: mocks.killSession,
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    listPaneValues: vi.fn(() => Effect.succeed([])),
  };
});

import { resumeAgent } from '../resume.js';
import { saveAgentStateSync, getAgentDir } from '../agent-state.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceStackHealthyForSpawn.mockResolvedValue(undefined);
  mocks.prepareHarnessLaunch.mockResolvedValue({ binaryPath: '/opt/kimi/bin/kimi', pathExport: "export PATH='/opt/kimi/bin':\"$PATH\"" });
  mocks.prepareSupervisorForRelaunch.mockResolvedValue({ useSupervisor: false, supervisorScriptPath: undefined });
  mocks.resolveHarness.mockResolvedValue('kimi-code');
  mocks.deliverInitialPromptWithRetry.mockResolvedValue({ ok: true, path: 'supervisor' });
  mocks.deliverResumeMessageWithTranscriptConfirmation.mockResolvedValue({ delivered: true, attempts: 1 });
  mocks.killSession.mockReturnValue(Effect.succeed(undefined));

  tempHome = mkdtempSync(join(tmpdir(), 'pan-resume-kimi-test-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-resume-kimi-workspace-'));
});

afterEach(() => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('resumeAgent — native Kimi Code session resume (PAN-1837 review fix)', () => {
  it('resumes with -S <captured-id> and delivers the continue message via the native readiness path', async () => {
    const agentId = 'agent-kimi-resume-e2e';
    const pinnedSessionId = 'pinned-kimi-session-e2e';

    mkdirSync(getAgentDir(agentId), { recursive: true });
    writeFileSync(join(getAgentDir(agentId), 'kimi-session-id'), `${pinnedSessionId}\n`);

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1837',
      workspace,
      harness: 'kimi-code',
      role: 'work',
      model: 'kimi-code/k3',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      kickoffDelivered: true,
    });

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(true);
    expect(result.messageDelivered).toBe(true);

    // The whole point of this fix: the launcher must actually resume the
    // captured native session, and the continue message must be delivered
    // through the native readiness path — not silently dropped by falling
    // through to the Claude-only SessionStart-hook branch.
    const launcher = readFileSync(join(getAgentDir(agentId), 'launcher.sh'), 'utf-8');
    expect(launcher).toContain(`-S '${pinnedSessionId}'`);
    expect(mocks.deliverInitialPromptWithRetry).toHaveBeenCalledWith(
      agentId,
      expect.any(String),
      'resumeAgent:kimi-code-continue',
    );
    expect(mocks.deliverResumeMessageWithTranscriptConfirmation).not.toHaveBeenCalled();
  });

  it('fails the resume and kills the session when the continue prompt never lands (PAN-1837 review fix, cycle 6)', async () => {
    // Kimi has no fallback signal (no SessionStart hook, no JSONL) to confirm
    // the message landed some other way, so a failed delivery here means the
    // continue/rework prompt is genuinely lost — this must not be reported as
    // a successfully resumed agent, unlike the pre-fix behavior that logged
    // the failure but still returned { success: true, messageDelivered: false }.
    mocks.deliverInitialPromptWithRetry.mockResolvedValue({ ok: false, failure: 'readiness timeout' });

    const agentId = 'agent-kimi-resume-delivery-failed';
    const pinnedSessionId = 'pinned-kimi-session-delivery-failed';

    mkdirSync(getAgentDir(agentId), { recursive: true });
    writeFileSync(join(getAgentDir(agentId), 'kimi-session-id'), `${pinnedSessionId}\n`);

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1837',
      workspace,
      harness: 'kimi-code',
      role: 'work',
      model: 'kimi-code/k3',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      kickoffDelivered: true,
    });

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Kimi Code continue prompt did not land');
    expect(mocks.killSession).toHaveBeenCalledWith(agentId);
  });
});
