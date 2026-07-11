import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleKnownAgentModal, paneShowsModelSwitch } from '../../../../src/lib/cloister/modal-detector.js';

afterEach(() => vi.useRealTimers());

describe('PAN-2543 Codex rate-limit modal detector', () => {
  it('selects Keep current model with Down then Enter, never bare Enter', async () => {
    vi.useFakeTimers();
    const capturePane = vi.fn()
      .mockResolvedValueOnce('rate limit reminder — switch model?\nSwitch to gpt-5.4-mini\nKeep current model (never show again)\nPress enter to confirm')
      .mockResolvedValueOnce('codex · model gpt-5.6 · ready');
    const sendKey = vi.fn(async () => undefined);
    const result = handleKnownAgentModal('agent-pan-2486', { capturePane, sendKey, settle: () => new Promise(resolve => setTimeout(resolve, 300)) });
    await vi.advanceTimersByTimeAsync(300);

    await expect(result).resolves.toBe('handled');
    expect(sendKey.mock.calls.map(call => call[1])).toEqual(['Down', 'Enter']);
  });

  it('escalates instead of retry-spamming when the dialog remains', async () => {
    vi.useFakeTimers();
    const pane = 'rate limit\nKeep current model';
    const result = handleKnownAgentModal('agent-pan-2486', {
      capturePane: vi.fn(async () => pane), sendKey: vi.fn(async () => undefined),
      settle: () => new Promise(resolve => setTimeout(resolve, 300)),
    });
    await vi.advanceTimersByTimeAsync(300);
    await expect(result).resolves.toBe('needs-you');
  });

  it('keeps JSONL attribution launch-scoped and detects a live switch from the pane fallback', () => {
    expect(paneShowsModelSwitch('Model switched to gpt-5.4-mini', 'gpt-5.6')).toBe(true);
    expect(paneShowsModelSwitch('codex ready · gpt-5.6', 'gpt-5.6')).toBe(false);
  });
});
