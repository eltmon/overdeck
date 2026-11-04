/** PAN-4653 WI-2: the global auto-settle-on-merge key defaults on and round-trips. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4653-auto-settle-setting-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('conversations.auto_settle_on_merge', () => {
  it('reads as on when unset', async () => {
    const { isConversationsAutoSettleOnMerge } = await import('../control-settings.js');
    expect(isConversationsAutoSettleOnMerge()).toBe(true);
  });

  it('reads as off after being set false, and stores the raw value false', async () => {
    const { isConversationsAutoSettleOnMerge, setConversationsAutoSettleOnMerge, getSetting, CONVERSATIONS_AUTO_SETTLE_ON_MERGE_KEY } =
      await import('../control-settings.js');
    setConversationsAutoSettleOnMerge(false);
    expect(isConversationsAutoSettleOnMerge()).toBe(false);
    expect(getSetting(CONVERSATIONS_AUTO_SETTLE_ON_MERGE_KEY)).toBe('false');
  });

  it('reads as on after being set true', async () => {
    const { isConversationsAutoSettleOnMerge, setConversationsAutoSettleOnMerge } = await import('../control-settings.js');
    setConversationsAutoSettleOnMerge(false);
    setConversationsAutoSettleOnMerge(true);
    expect(isConversationsAutoSettleOnMerge()).toBe(true);
  });
});
