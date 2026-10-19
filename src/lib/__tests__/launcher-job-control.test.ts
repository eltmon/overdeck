import { describe, expect, it } from 'vitest';

import { harnessLaunchLines } from '../launcher-job-control.js';

describe('harnessLaunchLines (PAN-4564)', () => {
  it('runs a claude-code harness as its own foreground job', () => {
    expect(harnessLaunchLines({}, ['claude --model x "$prompt"'])).toEqual(['set -m', 'claude --model x "$prompt"']);
  });

  it('turns a claude-code exec into a child that ends the launcher with its exit code', () => {
    expect(harnessLaunchLines({ harness: 'claude-code' }, ['exec claude --session-id s'])).toEqual([
      'set -m',
      'claude --session-id s',
      'exit $?',
    ]);
  });

  it('keeps exec for a PTY-supervisor launch', () => {
    expect(harnessLaunchLines({ useSupervisor: true }, ['exec node supervisor.js claude'])).toEqual([
      'set -m',
      'exec node supervisor.js claude',
    ]);
  });

  it('leaves harnesses that need no Herdr detection unchanged', () => {
    expect(harnessLaunchLines({ harness: 'codex' }, ['exec codex'])).toEqual(['exec codex']);
  });

  it('emits nothing when there is no command', () => {
    expect(harnessLaunchLines({}, [])).toEqual([]);
  });
});
