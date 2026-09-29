import { describe, expect, it } from 'vitest';

import {
  cpuClassForConversation,
  defaultCpuClass,
  withCpuClass,
} from '../../../../src/lib/terminal-backends/cpu-class.js';

const nice = { batch: 10, lane: 15 };
const argv = ['bash', '/home/e/.overdeck/agents/agent-pan-1/launcher.sh'];

describe('withCpuClass (PAN-4311)', () => {
  it('leaves an interactive launch unchanged', () => {
    expect(withCpuClass(argv, 'interactive', 'linux', nice)).toEqual(argv);
  });

  it('prefixes a batch launch with the agent nice level', () => {
    expect(withCpuClass(argv, 'batch', 'linux', nice)).toEqual(['nice', '-n', '10', '--', ...argv]);
  });

  it('prefixes a lane launch with the lane nice level', () => {
    expect(withCpuClass(argv, 'lane', 'linux', nice)).toEqual(['nice', '-n', '15', '--', ...argv]);
  });

  it('keeps nice on darwin, where the command exists', () => {
    expect(withCpuClass(argv, 'batch', 'darwin', nice)).toEqual(['nice', '-n', '10', '--', ...argv]);
  });

  it('leaves every launch unchanged on win32', () => {
    expect(withCpuClass(argv, 'batch', 'win32', nice)).toEqual(argv);
    expect(withCpuClass(argv, 'lane', 'win32', nice)).toEqual(argv);
  });
});

describe('CPU class defaults (PAN-4311)', () => {
  it('treats conversations as interactive and every other role as batch', () => {
    expect(defaultCpuClass('conversation')).toBe('interactive');
    for (const role of ['work', 'worker', 'review', 'test', 'uat', 'strike', 'plan'] as const) {
      expect(defaultCpuClass(role)).toBe('batch');
    }
  });

  it('derives lane from a conversation row with a lane role', () => {
    expect(cpuClassForConversation('builder', 'conversation')).toBe('lane');
    expect(cpuClassForConversation(null, 'conversation')).toBe('interactive');
    expect(cpuClassForConversation(undefined, 'conversation')).toBe('interactive');
    expect(cpuClassForConversation(null, 'worker')).toBe('batch');
  });
});
