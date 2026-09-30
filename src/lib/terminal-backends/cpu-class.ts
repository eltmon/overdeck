/**
 * CPU classes for agent launches (PAN-4311).
 *
 * Every Overdeck agent pane runs in the same cgroup (the Herdr server unit, or
 * the tmux server's), so CPU inside it is shared per thread. `nice` orders
 * those threads once the cpu controller is on: an operator conversation keeps
 * nice 0, batch agents yield to it, and gauntlet lanes yield to both.
 *
 * `nice` execs its command, so the pane's foreground process is still the
 * launcher and then the harness — Herdr's agent detection is unchanged.
 */

import type { AgentRole } from './types.js';

export type CpuClass = 'interactive' | 'batch' | 'lane';

export interface CpuClassNice {
  readonly batch: number;
  readonly lane: number;
}

/** Prefix batch and lane launches with `nice -n <level> --`; interactive and win32 are unchanged. */
export function withCpuClass(
  argv: readonly string[],
  cpuClass: CpuClass,
  platform: NodeJS.Platform,
  nice: CpuClassNice,
): readonly string[] {
  if (cpuClass === 'interactive' || platform === 'win32') return argv;
  const level = cpuClass === 'lane' ? nice.lane : nice.batch;
  return ['nice', '-n', String(level), '--', ...argv];
}

/** Operator conversations are interactive; every other role is batch work. */
export function defaultCpuClass(role: AgentRole): CpuClass {
  return role === 'conversation' ? 'interactive' : 'batch';
}

/** A conversation row with a lane role launches as `lane`, so a resumed lane keeps its class. */
export function cpuClassForConversation(laneRole: string | null | undefined, role: AgentRole): CpuClass {
  return laneRole ? 'lane' : defaultCpuClass(role);
}
