import { describe, expect, it } from 'vitest';

import { startLinkSupervisorWired } from '../link-supervisor-wiring.js';

describe('startLinkSupervisorWired (PAN-5046 FR-9)', () => {
  it('wires the status, presence and route sources before starting the supervisor', () => {
    const calls: string[] = [];
    const supervisor = { start: () => calls.push('start') };
    const wired: unknown[] = [];
    const setter = (name: string) => (source: typeof supervisor) => {
      calls.push(name);
      wired.push(source);
    };

    startLinkSupervisorWired(supervisor, [setter('status'), setter('presence'), setter('route')]);

    expect(calls).toEqual(['status', 'presence', 'route', 'start']);
    expect(wired).toEqual([supervisor, supervisor, supervisor]);
  });

  it('lets a link that comes online during start() find the route source', () => {
    let route: unknown = null;
    let seenByProbe: unknown = 'not run';
    const supervisor = {
      // A link online at once runs the linked syncs, which read the route source.
      start: () => {
        seenByProbe = route;
      },
    };

    startLinkSupervisorWired(supervisor, [(source) => (route = source)]);

    expect(seenByProbe).toBe(supervisor);
  });
});
