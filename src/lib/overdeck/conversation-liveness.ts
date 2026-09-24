/**
 * The one liveness door for conversations (PAN-3921 FR-7).
 *
 * Conversations launch through `launchAgentPane`, so on a Herdr host their pane
 * is a Herdr pane named `conv-<name>` and no tmux session exists. Every
 * conversation liveness read goes through here instead of asking tmux, or a
 * healthy Herdr-hosted conversation would read as dead everywhere.
 *
 * On Herdr:
 * - `indeterminate` (the socket did not answer) reads as alive, the rule
 *   `isAlive` applies to agents: a Herdr outage must never end every
 *   conversation at once.
 * - `absent` falls back to tmux. A conversation launched before the host moved
 *   to Herdr still runs in its tmux session, which Herdr knows nothing about.
 * - `exited` is dead: the pane is back at its shell, the harness is gone.
 *
 * On tmux every read is the tmux primitive it always was.
 */
import { Effect } from 'effect';

import { isHarnessProcessAlive, listSessionNames, sessionExists } from '../tmux.js';
import { hostTerminalBackendName } from '../terminal-backends/select.js';
import type { HerdrLivenessProbe } from '../terminal-backends/herdr.js';
import type { AgentState, TerminalBackendName } from '../terminal-backends/types.js';

/** Test seams. Production callers pass nothing. */
export interface ConversationLivenessDeps {
  readonly backend?: TerminalBackendName;
  readonly probeHerdr?: (name: string) => Promise<HerdrLivenessProbe>;
  readonly listHerdr?: () => Promise<readonly { readonly agentId: string; readonly state: AgentState }[]>;
  readonly sessionExists?: (name: string) => Promise<boolean>;
  readonly listSessionNames?: () => Promise<readonly string[]>;
  readonly harnessAlive?: (name: string) => Promise<boolean>;
  readonly sleep?: (ms: number) => Promise<void>;
}

const WAIT_POLL_MS = 250;

async function backendOf(deps: ConversationLivenessDeps): Promise<TerminalBackendName> {
  return deps.backend ?? (await hostTerminalBackendName());
}

function tmuxSessionExists(name: string, deps: ConversationLivenessDeps): Promise<boolean> {
  if (deps.sessionExists) return deps.sessionExists(name);
  return Effect.runPromise(sessionExists(name)).catch(() => false);
}

function tmuxSessionNames(deps: ConversationLivenessDeps): Promise<readonly string[]> {
  if (deps.listSessionNames) return deps.listSessionNames();
  return Effect.runPromise(listSessionNames()).catch(() => [] as string[]);
}

function tmuxHarnessAlive(name: string, deps: ConversationLivenessDeps): Promise<boolean> {
  return (deps.harnessAlive ?? isHarnessProcessAlive)(name);
}

async function probeHerdr(name: string, deps: ConversationLivenessDeps): Promise<HerdrLivenessProbe> {
  try {
    if (deps.probeHerdr) return await deps.probeHerdr(name);
    const { probeHerdrAgentLiveness } = await import('../terminal-backends/herdr.js');
    return await probeHerdrAgentLiveness(name);
  } catch (cause) {
    return { kind: 'indeterminate', reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Does the conversation's pane (Herdr) or session (tmux) exist and run something? */
export async function conversationSessionAlive(name: string, deps: ConversationLivenessDeps = {}): Promise<boolean> {
  if ((await backendOf(deps)) !== 'herdr') return tmuxSessionExists(name, deps);
  const probe = await probeHerdr(name, deps);
  if (probe.kind === 'absent') return tmuxSessionExists(name, deps);
  return probe.kind !== 'exited';
}

/** Is the conversation's harness process still running? */
export async function conversationHarnessAlive(name: string, deps: ConversationLivenessDeps = {}): Promise<boolean> {
  if ((await backendOf(deps)) !== 'herdr') return tmuxHarnessAlive(name, deps);
  const probe = await probeHerdr(name, deps);
  if (probe.kind !== 'absent') return probe.kind !== 'exited';
  return (await tmuxSessionExists(name, deps)) && (await tmuxHarnessAlive(name, deps));
}

/**
 * Names of every live conversation pane or session. On Herdr: every Herdr
 * agent not `exited`, plus every tmux session (legacy conversations). Null when
 * Herdr did not answer — the caller must treat liveness as unknown, never as
 * "nothing is alive".
 */
export async function listLiveConversationSessions(
  deps: ConversationLivenessDeps = {},
): Promise<ReadonlySet<string> | null> {
  if ((await backendOf(deps)) !== 'herdr') return new Set(await tmuxSessionNames(deps));
  let agents: readonly { readonly agentId: string; readonly state: AgentState }[];
  try {
    if (deps.listHerdr) {
      agents = await deps.listHerdr();
    } else {
      const { listHerdrAgents } = await import('../terminal-backends/herdr.js');
      agents = await listHerdrAgents();
    }
  } catch {
    return null;
  }
  const names = new Set(agents.filter((agent) => agent.state !== 'exited').map((agent) => agent.agentId));
  for (const name of await tmuxSessionNames(deps)) names.add(name);
  return names;
}

/** Wait until the conversation's pane or session is alive; throws after `timeoutMs`. */
export async function waitForConversationSession(
  name: string,
  timeoutMs = 30_000,
  deps: ConversationLivenessDeps = {},
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conversationSessionAlive(name, deps)) return;
    await sleep(WAIT_POLL_MS);
  }
  throw new Error(`Timed out waiting for conversation session ${name}`);
}
