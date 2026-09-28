import { describe, expect, it } from 'vitest';
import {
  assertPrimeAgentManagedCommandAllowed,
  PRIME_AGENT_MANAGED_POLICY,
  PrimeAgentManagedPolicyError,
} from '../policy.js';

describe('Prime Agent managed-session policy (PAN-3668 WI-9)', () => {
  it('states provenance, workspace, lifecycle, refine, child-agent, and state-write-door rules', () => {
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('operator messages');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('assigned Overdeck workspace');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('only lifecycle authority');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('Do not run `refine`, and do not change the root session.');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('not Overdeck agents');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('must never run pan done');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('single state write door');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('session-local');
  });

  it.each([
    'send_message',
    'agent_messages_status',
    'agent_messages_pause',
    'agent_messages_resume',
    'agent_messages_clear',
    'add_schedule',
    'cancel_schedule',
    'list_schedules',
    'get_heartbeat',
    'set_heartbeat',
    'update_heartbeat',
    'manage_heartbeat',
    'list_heartbeats',
    'observe',
    'unobserve',
    'refine',
    'new_session',
    'switch_session',
    'fork',
    'clone',
  ])('rejects managed command %s with a standalone explanation', (command) => {
    expect(() => assertPrimeAgentManagedCommandAllowed(command)).toThrow(PrimeAgentManagedPolicyError);
    expect(() => assertPrimeAgentManagedCommandAllowed(command)).toThrow(`"${command}" is unavailable for Overdeck-managed sessions`);
    expect(() => assertPrimeAgentManagedCommandAllowed(command)).toThrow('Cloister owns lifecycle and messaging');
  });

  it.each(['prompt', 'steer', 'follow_up', 'abort', 'get_state', 'get_messages', 'get_session_stats', 'set_thinking_level', 'extension_ui_response'])(
    'allows root-session command %s',
    (command) => expect(() => assertPrimeAgentManagedCommandAllowed(command)).not.toThrow(),
  );
});
