import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloisterApiMock = vi.fn();
vi.mock('../../../../src/cli/commands/cloister/api.js', () => ({
  cloisterApi: (path: string, init?: RequestInit) => cloisterApiMock(path, init),
}));

import { stopCommand } from '../../../../src/cli/commands/cloister/stop.js';

const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';

describe('pan cloister stop --emergency output (#4109)', () => {
  let lines: string[];
  let previousLevel: typeof chalk.level;

  beforeEach(() => {
    lines = [];
    previousLevel = chalk.level;
    chalk.level = 1;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    cloisterApiMock.mockReset();
  });

  afterEach(() => {
    chalk.level = previousLevel;
    vi.restoreAllMocks();
  });

  function respond(body: unknown) {
    cloisterApiMock.mockImplementation(async (path: string) =>
      path === '/api/cloister/status' ? { running: true } : body);
  }

  it('names the agents it could not confirm stopped, in yellow, not green', async () => {
    respond({ killedAgents: ['agent-pan-1'], unconfirmedAgents: ['agent-pan-2', 'agent-pan-3'] });

    await stopCommand({ emergency: true });

    const warning = lines.find((line) => line.includes('could not be confirmed stopped'));
    expect(warning).toBeDefined();
    expect(warning).toContain('2 agent(s) could not be confirmed stopped: agent-pan-2, agent-pan-3');
    expect(warning).toContain(YELLOW);
    expect(warning).not.toContain(GREEN);
    expect(lines.some((line) => line.includes('Killed 1 agent(s)'))).toBe(true);
  });

  it('prints no warning when every stop was confirmed', async () => {
    respond({ killedAgents: ['agent-pan-1'], unconfirmedAgents: [] });

    await stopCommand({ emergency: true });

    expect(lines.some((line) => line.includes('could not be confirmed'))).toBe(false);
  });
});
