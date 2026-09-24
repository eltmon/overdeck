import { beforeEach, describe, expect, it, vi } from 'vitest';

const herdrApi = vi.hoisted(() => ({ call: vi.fn() }));

// The Herdr socket client is the only seam: the real `readHerdrPaneText` and
// `sendHerdrPaneKeys` run against it, so the test sees the exact requests.
vi.mock('../../terminal-backends/herdr-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/herdr-api.js')>();
  return { ...actual, getHerdrApiClient: () => herdrApi };
});

import type { Role } from '../role.js';
import { prepareAutonomousAgentResumePane } from '../resume-pane-choice.js';
import type { AgentPaneRef } from '../../terminal-backends/types.js';

const RESUME_GATE_MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

const PERMISSION_MENU = [
  'Claude needs your permission to use Bash',
  '',
  '❯ 1. Yes',
  '  2. No',
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

const CLEAR_COMPOSER = [
  '● Resumed from a compacted summary.',
  '',
  '─────────────────────────────',
  '❯ ',
  '─────────────────────────────',
].join('\n');

function paneDeps(initialPane: string, afterAnswer = CLEAR_COMPOSER) {
  let captureCount = 0;
  return {
    capture: vi.fn(async () => {
      captureCount += 1;
      return captureCount < 3 ? initialPane : afterAnswer;
    }),
    sessionExists: vi.fn(async () => true),
    sendKey: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
  };
}

describe('prepareAutonomousAgentResumePane (PAN-3636)', () => {
  it.each<Role>(['work', 'review', 'test', 'strike'])(
    'selects Resume from summary for autonomous %s agents before continuation delivery',
    async (role) => {
      const deps = paneDeps(RESUME_GATE_MENU);

      const result = await prepareAutonomousAgentResumePane('agent-pan-3411', role, deps);

      expect(result).toEqual({ ready: true, action: 'resumed-from-summary' });
      expect(deps.sendKey.mock.calls.map(([, key]) => key)).toEqual(['Enter']);
    },
  );

  it('passes through immediately when the resumed session already has a composer', async () => {
    const deps = paneDeps(CLEAR_COMPOSER);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3411', 'work', deps);

    expect(result).toEqual({ ready: true, action: 'clear' });
    expect(deps.sendKey).not.toHaveBeenCalled();
  });

  it('does not auto-answer arbitrary permission or AUQ menus', async () => {
    const deps = paneDeps(PERMISSION_MENU);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3411', 'work', deps);

    expect(result).toEqual({
      ready: false,
      reason: 'pane is blocked on a choice menu other than the Claude resume-summary gate',
    });
    expect(deps.sendKey).not.toHaveBeenCalled();
  });

  it('does not auto-answer the resume gate for roles outside the autonomous delivery set', async () => {
    const deps = paneDeps(RESUME_GATE_MENU);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3411-plan', 'plan', deps);

    expect(result).toEqual({
      ready: false,
      reason: 'pane is blocked on a choice menu that role=plan may not answer automatically',
    });
    expect(deps.sendKey).not.toHaveBeenCalled();
  });

  it('fails closed when the typed pane-choice door cannot dismiss the menu', async () => {
    const deps = paneDeps(RESUME_GATE_MENU, RESUME_GATE_MENU);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3411', 'work', deps);

    expect(result).toEqual({
      ready: false,
      reason: 'could not select Resume from summary: Keystrokes were sent but the menu is still on screen — answer it from the terminal',
    });
    expect(deps.sendKey).toHaveBeenCalledWith('agent-pan-3411', 'Enter');
  });
});

describe('prepareAutonomousAgentResumePane on a Herdr pane (review of #3992, M2)', () => {
  const pane: AgentPaneRef = {
    backend: 'herdr',
    workspaceId: 'w1',
    paneId: 'w1:p7',
    terminalId: 'term-7',
    agentName: 'agent-pan-3960',
  };

  beforeEach(() => {
    herdrApi.call.mockReset();
  });

  function herdrScreens(...screens: string[]): void {
    let reads = 0;
    herdrApi.call.mockImplementation(async (method: string) => {
      if (method === 'pane.read') {
        const screen = screens[Math.min(reads, screens.length - 1)]!;
        reads += 1;
        return { text: screen };
      }
      if (method === 'pane.send_keys') return {};
      throw new Error(`unexpected herdr call ${method}`);
    });
  }

  it('reads the Herdr pane and selects Resume from summary with pane.send_keys', async () => {
    herdrScreens(RESUME_GATE_MENU, RESUME_GATE_MENU, CLEAR_COMPOSER);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3960', 'work', {
      pane,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ ready: true, action: 'resumed-from-summary' });
    expect(herdrApi.call).toHaveBeenCalledWith('pane.read', expect.objectContaining({ pane_id: 'w1:p7' }));
    expect(herdrApi.call).toHaveBeenCalledWith('pane.send_keys', { pane_id: 'w1:p7', keys: ['enter'] });
  });

  it('passes through when the Herdr pane shows a composer', async () => {
    herdrScreens(CLEAR_COMPOSER);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3960', 'work', { pane });

    expect(result).toEqual({ ready: true, action: 'clear' });
    expect(herdrApi.call).not.toHaveBeenCalledWith('pane.send_keys', expect.anything());
  });

  it('fails safe when the Herdr pane cannot be read — nothing is typed blind', async () => {
    herdrApi.call.mockRejectedValue(new Error('socket timeout'));

    const result = await prepareAutonomousAgentResumePane('agent-pan-3960', 'work', { pane });

    expect(result).toEqual({
      ready: false,
      reason: 'could not read herdr pane w1:p7 to check for a resume menu: socket timeout',
    });
    expect(herdrApi.call).not.toHaveBeenCalledWith('pane.send_keys', expect.anything());
  });

  it('keeps the tmux door for a tmux pane', async () => {
    const deps = paneDeps(CLEAR_COMPOSER);

    const result = await prepareAutonomousAgentResumePane('agent-pan-3960', 'work', {
      ...deps,
      pane: { ...pane, backend: 'tmux', paneId: 'agent-pan-3960' },
    });

    expect(result).toEqual({ ready: true, action: 'clear' });
    expect(deps.capture).toHaveBeenCalledWith('agent-pan-3960', 90);
    expect(herdrApi.call).not.toHaveBeenCalled();
  });
});
