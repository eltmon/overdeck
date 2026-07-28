import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: execFileMock,
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => ({ config: { tmux: { configMode: 'inherit-user' } } }),
  };
});

/** Verbatim resume-gate menu from tests/lib/pane-choice-menu.test.ts. */
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

const CLEAR_COMPOSER = [
  '● All done — the full task list is closed out.',
  '',
  '─────────────────────────────',
  '❯ ',
  '─────────────────────────────',
].join('\n');

const PAYLOAD = 'CONVERSATION RESUME:\nverify-line-payload';
const VERIFY_LINE = 'verify-line-payload';

type Scenario = 'menu' | 'composer' | 'verified';

function installTmuxScenario(scenario: Scenario): void {
  let submitted = false;

  execFileMock.mockImplementation(
    (_command: string, args: string[], _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const subcommand = args[0];
      if (subcommand === 'send-keys' && args.at(-1) === 'C-m') {
        submitted = true;
      }

      let stdout = '';
      if (subcommand === 'capture-pane') {
        if (scenario === 'menu') stdout = RESUME_GATE_MENU;
        if (scenario === 'composer') stdout = CLEAR_COMPOSER;
        if (scenario === 'verified') stdout = submitted ? CLEAR_COMPOSER : `${CLEAR_COMPOSER}\n${VERIFY_LINE}`;
      }

      callback(null, { stdout, stderr: '' });
    },
  );
}

function enterCalls(): unknown[][] {
  return execFileMock.mock.calls.filter(([, args]) => (
    Array.isArray(args)
    && args[0] === 'send-keys'
    && args[1] === '-t'
    && args[2] === 'conv-test'
    && args[3] === 'C-m'
  ));
}

describe('sendKeys blocking-menu guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    execFileMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rejects without pressing Enter when a blocking menu swallowed the paste', async () => {
    installTmuxScenario('menu');
    const { MessageDeliveryFailed, sendKeys } = await import('../../src/lib/tmux.js');

    const delivery = Effect.runPromise(sendKeys('conv-test', PAYLOAD));
    await vi.advanceTimersByTimeAsync(0);
    const rejection = expect(delivery).rejects.toBeInstanceOf(MessageDeliveryFailed);
    await vi.advanceTimersByTimeAsync(3_500);

    await rejection;
    expect(enterCalls()).toHaveLength(0);
  });

  it('preserves fail-open submission for an idle composer when paste verification fails', async () => {
    installTmuxScenario('composer');
    const { sendKeys } = await import('../../src/lib/tmux.js');

    const delivery = Effect.runPromise(sendKeys('conv-test', PAYLOAD));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_500);

    await expect(delivery).resolves.toBeUndefined();
    expect(enterCalls()).toHaveLength(1);
  });

  it('submits once when the pasted verify line is visible', async () => {
    installTmuxScenario('verified');
    const { sendKeys } = await import('../../src/lib/tmux.js');

    const delivery = Effect.runPromise(sendKeys('conv-test', PAYLOAD));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(delivery).resolves.toBeUndefined();
    expect(enterCalls()).toHaveLength(1);
  });
});
