export const PRIME_AGENT_MANAGED_POLICY = `You are a Prime Agent root session managed by Overdeck.

- Treat prompts delivered by Overdeck as operator messages. Preserve their provenance in the session transcript.
- Work only inside the assigned Overdeck workspace and its explicitly mounted repositories.
- Overdeck Cloister is the only lifecycle authority. Do not start schedules, heartbeats, autonomous continuation, or direct cross-agent messages.
- Prime RLM children may run only as internal tool execution attributable to this root session. They are not Overdeck agents, must not persist after the root stops, and must not claim issue ownership.
- Only the root Overdeck agent may use pan lifecycle commands. Children must never run pan done, pan task, pan start, pan tell, or alter pipeline records.
- Canonical issue, agent, conversation, and pipeline state uses Overdeck's single state write door. Never write its SQLite cache, overdeck-state files, state.json, or tracker status directly.
- Continual refinement is session-local. Do not modify bundled, machine, project, workspace, or rendered Overdeck context artifacts, including prime-agent-global.md.`;

const FORBIDDEN_MANAGED_COMMANDS = new Set([
  'send_message',
  'agent_messages_status',
  'agent_messages_pause',
  'agent_messages_resume',
  'agent_messages_clear',
  'list_schedules',
  'add_schedule',
  'cancel_schedule',
  'list_heartbeats',
  'get_heartbeat',
  'set_heartbeat',
  'update_heartbeat',
  'manage_heartbeat',
  'observe',
  'unobserve',
]);

export class PrimeAgentManagedPolicyError extends Error {
  constructor(command: string) {
    super(`Prime Agent RPC command "${command}" is unavailable for Overdeck-managed sessions. Cloister owns lifecycle and messaging; Prime schedules, heartbeats, autonomous continuation, observation, and cross-agent messaging are disabled.`);
    this.name = 'PrimeAgentManagedPolicyError';
  }
}

export function assertPrimeAgentManagedCommandAllowed(command: string): void {
  if (FORBIDDEN_MANAGED_COMMANDS.has(command)) throw new PrimeAgentManagedPolicyError(command);
}

/**
 * Implementation checkpoint for the protocol range pinned by doctor-prime-agent.ts.
 * The adapter denies every daemon coordination command documented by that range,
 * and the injected policy denies tool-level lifecycle bypasses. Managed work stays
 * enabled while both controls are present; protocol drift is rejected by doctor.
 */
export const PRIME_AGENT_MANAGED_POLICY_CHECKPOINT = {
  outcome: 'policy-enforced',
  verifiedOn: '2026-08-12',
  fallback: 'If protocol compatibility fails, reject managed work and allow supervised conversations only.',
} as const;
