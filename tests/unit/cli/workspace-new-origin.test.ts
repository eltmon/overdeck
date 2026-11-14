/**
 * PAN-5233 FR-4: `resolveNewWorkspaceOrigin` picks `agent` inside a managed
 * session and `operator` otherwise, with an explicit `--origin` winning.
 */
import { describe, expect, it } from 'vitest';
import { resolveNewWorkspaceOrigin } from '../../../src/cli/commands/workspace-scratch.js';

describe('resolveNewWorkspaceOrigin (PAN-5233)', () => {
  it('defaults to operator outside a managed session', () => {
    expect(resolveNewWorkspaceOrigin(undefined, {})).toBe('operator');
  });

  it('defaults to agent when OVERDECK_AGENT_ID is set', () => {
    expect(resolveNewWorkspaceOrigin(undefined, { OVERDECK_AGENT_ID: 'agent-pan-1' })).toBe('agent');
  });

  it('defaults to agent when OVERDECK_CONVERSATION is set', () => {
    expect(resolveNewWorkspaceOrigin(undefined, { OVERDECK_CONVERSATION: 'conv-12' })).toBe('agent');
  });

  it('an explicit --origin operator wins over a managed session', () => {
    expect(resolveNewWorkspaceOrigin('operator', { OVERDECK_AGENT_ID: 'agent-pan-1' })).toBe('operator');
  });

  it('an invalid --origin value throws', () => {
    expect(() => resolveNewWorkspaceOrigin('pipeline', {})).toThrow(/Invalid --origin/);
  });
});
