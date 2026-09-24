/**
 * PAN-3928: `pan start`, `pan strike` and `pan recover` printed a tmux attach
 * command for agents whose pane lives on Herdr, where no tmux session exists.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachHintLines,
  describeAttach,
  resolveAttach,
} from '../../../../src/lib/terminal-backends/attach-hint.js';
import { herdrSessionName } from '../../../../src/lib/terminal-backends/select.js';
import { getManagedTmuxSocketName } from '../../../../src/lib/tmux.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('describeAttach', () => {
  it("attaches a Herdr agent by its terminal id, in this home's Herdr session", () => {
    const hint = describeAttach({ id: 'agent-pan-1', backend: 'herdr', paneId: 'wG:p2', terminalId: 'term_1' });
    expect(hint.location).toBe('herdr (pane wG:p2)');
    expect(hint.command).toBe(`herdr --session ${herdrSessionName()} terminal attach term_1`);
  });

  it('falls back to the Herdr agent name when no terminal id was recorded', () => {
    const hint = describeAttach({ id: 'agent-pan-1', backend: 'herdr' });
    expect(hint.location).toBe('herdr (pane not recorded)');
    expect(hint.command).toBe(`herdr --session ${herdrSessionName()} agent attach agent-pan-1`);
  });

  it('uses the managed tmux socket for a tmux agent', () => {
    const hint = describeAttach({ id: 'agent-pan-1', backend: 'tmux', paneId: 'agent-pan-1' });
    expect(hint.location).toBe('tmux (session agent-pan-1)');
    expect(hint.command).toBe(`tmux -L ${getManagedTmuxSocketName()} attach -t agent-pan-1`);
  });

  it('honors OVERDECK_TMUX_SOCKET_NAME', () => {
    vi.stubEnv('OVERDECK_TMUX_SOCKET_NAME', 'sock-x');
    expect(describeAttach({ id: 'agent-pan-1', backend: 'tmux' }).command)
      .toBe('tmux -L sock-x attach -t agent-pan-1');
  });

  it('derives the Herdr session from a non-default OVERDECK_HOME', () => {
    vi.stubEnv('OVERDECK_HOME', '/tmp/pan-3928-home');
    expect(describeAttach({ id: 'agent-pan-1', backend: 'herdr' }).command)
      .toMatch(/^herdr --session overdeck-[0-9a-f]{8} agent attach agent-pan-1$/);
  });
});

describe('resolveAttach', () => {
  it('prefers the backend the agent state recorded over the host selection', async () => {
    const hostBackend = vi.fn(async () => 'tmux' as const);
    const hint = await resolveAttach({ id: 'agent-pan-1', backend: 'herdr', terminalId: 'term_1' }, hostBackend);
    expect(hint.command).toBe(`herdr --session ${herdrSessionName()} terminal attach term_1`);
    expect(hostBackend).not.toHaveBeenCalled();
  });

  it('asks the host selection when the state recorded no backend', async () => {
    const herdr = await resolveAttach({ id: 'agent-pan-1' }, async () => 'herdr');
    expect(herdr.command).toBe(`herdr --session ${herdrSessionName()} agent attach agent-pan-1`);
    const tmux = await resolveAttach({ id: 'agent-pan-1' }, async () => 'tmux');
    expect(tmux.command).toBe(`tmux -L ${getManagedTmuxSocketName()} attach -t agent-pan-1`);
  });

  it('renders the Backend and Attach lines of a Commands block', async () => {
    const lines = await attachHintLines({ id: 'agent-pan-1', backend: 'herdr', paneId: 'wG:p2', terminalId: 'term_1' });
    expect(lines).toEqual([
      '  Backend:  herdr (pane wG:p2)',
      `  Attach:   herdr --session ${herdrSessionName()} terminal attach term_1`,
    ]);
  });
});

describe('CLI attach hints', () => {
  it.each(['start.ts', 'strike.ts', 'recover.ts'])('%s prints no hardcoded tmux attach command', (file) => {
    const source = readFileSync(join(__dirname, '../../../../src/cli/commands', file), 'utf-8');
    expect(source).not.toMatch(/tmux (-L \S+ )?attach -t/);
    expect(source).toMatch(/attachHintLines|resolveAttach/);
  });
});
