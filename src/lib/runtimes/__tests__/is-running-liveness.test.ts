/**
 * #4116: every runtime's `isRunning` answers through the backend-aware
 * liveness oracle. A Herdr agent has no tmux session, so the old tmux-only
 * probes read every live Herdr agent as not running.
 *
 * The host backend is a fake Herdr: `hostTerminalBackendName` answers
 * `herdr`, the Herdr liveness probe answers from a table, and no tmux session
 * exists anywhere (neither the legacy check behind Herdr's `absent` nor the
 * runtimes' own tmux probes find one).
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HerdrLivenessProbe } from '../../terminal-backends/herdr.js';

const herdrWorld = vi.hoisted(() => ({ answers: {} as Record<string, string> }));

vi.mock('../../terminal-backends/select.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hostTerminalBackendName: async () => 'herdr',
}));

vi.mock('../../terminal-backends/herdr.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeHerdrAgentLiveness: async (id: string): Promise<HerdrLivenessProbe> => {
    const kind = herdrWorld.answers[id] ?? 'absent';
    if (kind === 'alive') return { kind, paneId: 'w1:p1', state: 'working' } as unknown as HerdrLivenessProbe;
    if (kind === 'exited') return { kind, paneId: 'w1:p1' } as HerdrLivenessProbe;
    if (kind === 'indeterminate') return { kind, reason: 'socket did not answer' } as HerdrLivenessProbe;
    return { kind: 'absent' } as HerdrLivenessProbe;
  },
}));

vi.mock('../../agents/tmux-session-query.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryTmuxSession: async () => 'missing',
}));

vi.mock('../tmux-cli.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tmuxSessionExists: async () => false,
}));

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sessionExists: () => Effect.succeed(false),
  sessionExistsSync: () => false,
}));

// The registry module registers the backend-aware probe the runtimes ask.
import '../index.js';
import { AcpRuntimeSync } from '../acp.js';
import { ClaudeCodeRuntimeSync } from '../claude-code.js';
import { CodexRuntimeSync } from '../codex.js';
import { KimiCodeRuntimeSync } from '../kimi-code.js';
import { MuseRuntimeSync } from '../muse.js';
import { OhmypiRuntimeSync } from '../ohmypi.js';

const RUNTIMES = [
  ['claude-code', () => new ClaudeCodeRuntimeSync()],
  ['codex', () => new CodexRuntimeSync()],
  ['kimi-code', () => new KimiCodeRuntimeSync()],
  ['acp', () => new AcpRuntimeSync()],
  ['muse', () => new MuseRuntimeSync()],
  ['ohmypi', () => new OhmypiRuntimeSync()],
] as const;

describe.each(RUNTIMES)('%s runtime isRunning on a Herdr host', (_name, create) => {
  beforeEach(() => {
    herdrWorld.answers = {};
  });

  it('reads a live Herdr agent (no tmux session) as running', async () => {
    herdrWorld.answers['agent-pan-4116'] = 'alive';
    await expect(Promise.resolve(create().isRunning('agent-pan-4116'))).resolves.toBe(true);
  });

  it('reads an exited or vanished Herdr agent as not running', async () => {
    herdrWorld.answers['agent-pan-1'] = 'exited';
    const runtime = create();
    await expect(Promise.resolve(runtime.isRunning('agent-pan-1'))).resolves.toBe(false);
    await expect(Promise.resolve(runtime.isRunning('agent-pan-2'))).resolves.toBe(false);
  });

  it('does not confirm an agent the backend cannot answer for', async () => {
    herdrWorld.answers['agent-pan-4116'] = 'indeterminate';
    await expect(Promise.resolve(create().isRunning('agent-pan-4116'))).resolves.toBe(false);
  });
});
