import { describe, expect, it, vi } from 'vitest';

import type { Role } from '../role.js';
import { prepareAutonomousAgentResumePane } from '../resume-pane-choice.js';

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
