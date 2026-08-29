import { describe, expect, it } from 'vitest';
import {
  assertPrimeAgentManagedCommandAllowed,
  PRIME_AGENT_MANAGED_POLICY,
  PRIME_AGENT_MANAGED_POLICY_CHECKPOINT,
  PrimeAgentManagedPolicyError,
} from '../../../../src/lib/prime-agent/policy.js';

describe('Prime Agent managed-session policy', () => {
  it('states provenance, workspace, lifecycle, child-agent, and state-write-door rules', () => {
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('operator messages');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('assigned Overdeck workspace');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('only lifecycle authority');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('not Overdeck agents');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('must never run pan done');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('single state write door');
    expect(PRIME_AGENT_MANAGED_POLICY).toContain('session-local');
  });

  it.each(['add_schedule', 'set_heartbeat', 'send_message', 'observe'])(
    'rejects managed daemon command %s with a standalone explanation',
    (command) => {
      expect(() => assertPrimeAgentManagedCommandAllowed(command)).toThrow(PrimeAgentManagedPolicyError);
      expect(() => assertPrimeAgentManagedCommandAllowed(command)).toThrow('Cloister owns lifecycle and messaging');
    },
  );

  it.each(['prompt', 'steer', 'follow_up', 'abort', 'get_state', 'get_messages', 'get_session_stats'])(
    'allows root-session command %s',
    (command) => expect(() => assertPrimeAgentManagedCommandAllowed(command)).not.toThrow(),
  );

  it('records the pinned-protocol checkpoint and fallback', () => {
    expect(PRIME_AGENT_MANAGED_POLICY_CHECKPOINT).toMatchObject({ outcome: 'policy-enforced', verifiedOn: '2026-08-12' });
    expect(PRIME_AGENT_MANAGED_POLICY_CHECKPOINT.fallback).toContain('supervised conversations only');
  });
});
