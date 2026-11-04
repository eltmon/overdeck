/** `pan conv auto-settle-idle-days` and the conversations.auto_settle_idle_days door (PAN-4655). */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../../tests/helpers/overdeck-test-db.js';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  process.env.HOME = odb.home;
});

afterEach(() => {
  delete process.env.HOME;
  teardownOverdeckTestDb(odb);
  vi.restoreAllMocks();
});

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));
  vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg ?? '')));
  return { logs, errors };
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
}

describe('autoSettleIdleDaysAction', () => {
  it('shows 3 by default, sets 5, and shows 0 as off', async () => {
    const { autoSettleIdleDaysAction } = await import('../auto-settle.js');
    const { getConversationsAutoSettleIdleDays } = await import('../../../../lib/overdeck/control-settings.js');
    const { logs } = captureConsole();

    await autoSettleIdleDaysAction();
    expect(logs.at(-1)).toBe('3');

    await autoSettleIdleDaysAction('5');
    expect(logs.at(-1)).toBe('✓ Conversations idle for 5 day(s) are settled automatically');
    expect(getConversationsAutoSettleIdleDays()).toBe(5);
    await autoSettleIdleDaysAction();
    expect(logs.at(-1)).toBe('5');

    await autoSettleIdleDaysAction('0');
    expect(logs.at(-1)).toBe('✓ Idle auto-settle is off');
    await autoSettleIdleDaysAction();
    expect(logs.at(-1)).toBe('0 (off)');
  });

  it.each(['abc', '-1', '366', '1.5'])('exits 1 on "%s" and leaves the value unchanged', async (value) => {
    const { autoSettleIdleDaysAction } = await import('../auto-settle.js');
    const { getConversationsAutoSettleIdleDays, setConversationsAutoSettleIdleDays } = await import(
      '../../../../lib/overdeck/control-settings.js'
    );
    setConversationsAutoSettleIdleDays(7);
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(autoSettleIdleDaysAction(value)).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.at(-1)).toBe(`Error: expected a whole number of days from 0 to 365, got "${value}"`);
    expect(getConversationsAutoSettleIdleDays()).toBe(7);
  });
});

describe('conversations.auto_settle_idle_days door', () => {
  it('reads an invalid stored value as 3 and warns', async () => {
    const { getConversationsAutoSettleIdleDays, setSetting, CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY } = await import(
      '../../../../lib/overdeck/control-settings.js'
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSetting(CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY, 'garbage');
    expect(getConversationsAutoSettleIdleDays()).toBe(3);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('parses whole numbers 0..365 from numbers and digit strings only', async () => {
    const { parseAutoSettleIdleDays } = await import('../../../../lib/overdeck/control-settings.js');
    expect(parseAutoSettleIdleDays(0)).toBe(0);
    expect(parseAutoSettleIdleDays('5')).toBe(5);
    expect(parseAutoSettleIdleDays(365)).toBe(365);
    for (const bad of [-1, 1.5, 'abc', 366, '', null, undefined, '1e2']) {
      expect(parseAutoSettleIdleDays(bad)).toBeNull();
    }
  });

  it('throws RangeError for a non-integer and persists nothing; stores a valid value as a string', async () => {
    const { setConversationsAutoSettleIdleDays, getSetting, CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY } = await import(
      '../../../../lib/overdeck/control-settings.js'
    );
    expect(() => setConversationsAutoSettleIdleDays(1.5)).toThrow(RangeError);
    expect(getSetting(CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY)).toBeNull();
    setConversationsAutoSettleIdleDays(5);
    expect(getSetting(CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY)).toBe('5');
  });
});

describe('registerConversationsCommands', () => {
  it('registers auto-settle-idle-days with an optional days argument', async () => {
    const { registerConversationsCommands } = await import('../index.js');
    const program = new Command();
    registerConversationsCommands(program);
    const conversations = program.commands.find((command) => command.name() === 'conversations');
    const verb = conversations?.commands.find((command) => command.name() === 'auto-settle-idle-days');
    expect(verb?.registeredArguments.map((arg) => arg.name())).toEqual(['days']);
    expect(verb?.registeredArguments[0]?.required).toBe(false);
  });
});
