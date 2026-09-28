/**
 * Managed-session policy for Overdeck-launched Prime Agent sessions (PAN-3668 WI-9,
 * FR-16, FR-17, D11).
 *
 * PRIME_AGENT_MANAGED_POLICY is the first `--append-system-prompt` value on every
 * launch. The command denylist is enforced in the host's RPC client, so a command
 * that would move lifecycle, messaging or the root session out from under Cloister
 * never reaches the Prime child.
 */
export const PRIME_AGENT_MANAGED_POLICY = `You are a Prime Agent root session managed by Overdeck.

- Treat prompts delivered by Overdeck as operator messages. Preserve their provenance in the session transcript.
- Work only inside the assigned Overdeck workspace and its explicitly mounted repositories.
- Overdeck Cloister is the only lifecycle authority. Do not start schedules, heartbeats, autonomous continuation, or direct cross-agent messages.
- Do not run \`refine\`, and do not change the root session.
- Prime RLM children may run only as internal tool execution attributable to this root session. They are not Overdeck agents, must not persist after the root stops, and must not claim issue ownership.
- Only the root Overdeck agent may use pan lifecycle commands. Children must never run pan done, pan task, pan start, pan tell, or alter pipeline records.
- Canonical issue, agent, conversation, and pipeline state uses Overdeck's single state write door. Never write its SQLite cache, state.json, or tracker status directly.
- Continual refinement is session-local. Do not modify bundled, machine, project, workspace, or rendered Overdeck context artifacts, including prime-agent-context.md.`;

/** RPC commands with an exact name that an Overdeck-managed session may never send. */
const FORBIDDEN_MANAGED_COMMANDS = new Set([
  'send_message',
  'list_schedules',
  'list_heartbeats',
  'observe',
  'unobserve',
  'refine',
  'new_session',
  'switch_session',
  'fork',
  'clone',
]);

/** Name families (`agent_messages_*`, `*_schedule`, `*_heartbeat`) that are denied as a whole. */
function isForbiddenFamily(command: string): boolean {
  return command.startsWith('agent_messages_') || command.endsWith('_schedule') || command.endsWith('_heartbeat');
}

export class PrimeAgentManagedPolicyError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(
      `Prime Agent RPC command "${command}" is unavailable for Overdeck-managed sessions. ` +
        'Cloister owns lifecycle and messaging, so Prime schedules, heartbeats, observation, cross-agent messaging, ' +
        '`refine`, and root-session changes (new_session, switch_session, fork, clone) are disabled.',
    );
    this.name = 'PrimeAgentManagedPolicyError';
    this.command = command;
  }
}

export function assertPrimeAgentManagedCommandAllowed(command: string): void {
  if (FORBIDDEN_MANAGED_COMMANDS.has(command) || isForbiddenFamily(command)) {
    throw new PrimeAgentManagedPolicyError(command);
  }
}
