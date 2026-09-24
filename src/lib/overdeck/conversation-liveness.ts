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
 * On tmux every read asks tmux first, and then Herdr when its socket answers
 * (rollback safety): a conversation launched on Herdr keeps running in its
 * Herdr pane after the host flips to `terminal.backend: tmux`, and reading it
 * as dead would end its row and let a Resume start a second harness on the
 * same transcript. There only a Herdr `alive` counts; an unreachable Herdr is
 * the normal state of a tmux host, never evidence of life.
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

async function herdrReportsAlive(name: string, deps: ConversationLivenessDeps): Promise<boolean> {
  return (await probeHerdr(name, deps)).kind === 'alive';
}

async function listHerdr(deps: ConversationLivenessDeps): Promise<readonly { readonly agentId: string; readonly state: AgentState }[]> {
  if (deps.listHerdr) return deps.listHerdr();
  const { listHerdrAgents } = await import('../terminal-backends/herdr.js');
  return listHerdrAgents();
}

/** Does the conversation's pane (Herdr) or session (tmux) exist and run something? */
export async function conversationSessionAlive(name: string, deps: ConversationLivenessDeps = {}): Promise<boolean> {
  if ((await backendOf(deps)) !== 'herdr') {
    return (await tmuxSessionExists(name, deps)) || (await herdrReportsAlive(name, deps));
  }
  const probe = await probeHerdr(name, deps);
  if (probe.kind === 'absent') return tmuxSessionExists(name, deps);
  return probe.kind !== 'exited';
}

/** Is the conversation's harness process still running? */
export async function conversationHarnessAlive(name: string, deps: ConversationLivenessDeps = {}): Promise<boolean> {
  if ((await backendOf(deps)) !== 'herdr') {
    return (await tmuxHarnessAlive(name, deps)) || (await herdrReportsAlive(name, deps));
  }
  const probe = await probeHerdr(name, deps);
  if (probe.kind !== 'absent') return probe.kind !== 'exited';
  return (await tmuxSessionExists(name, deps)) && (await tmuxHarnessAlive(name, deps));
}

/**
 * Names of every live conversation pane or session: every Herdr agent not
 * `exited`, plus every tmux session. On Herdr, null when Herdr did not answer —
 * the caller must treat liveness as unknown, never as "nothing is alive". On
 * tmux an unreachable Herdr adds nothing.
 */
export async function listLiveConversationSessions(
  deps: ConversationLivenessDeps = {},
): Promise<ReadonlySet<string> | null> {
  if ((await backendOf(deps)) !== 'herdr') {
    const names = new Set(await tmuxSessionNames(deps));
    const herdrAgents = await listHerdr(deps).catch(() => []);
    for (const agent of herdrAgents) {
      if (agent.state !== 'exited' && agent.agentId.startsWith('conv-')) names.add(agent.agentId);
    }
    return names;
  }
  let agents: readonly { readonly agentId: string; readonly state: AgentState }[];
  try {
    agents = await listHerdr(deps);
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

/**
 * Close a conversation's pane wherever it runs: its Herdr pane and its tmux
 * session alike, whichever backend the host selects now. A stop or respawn
 * that only reached the host's current backend would leave the other one's
 * harness running on the same transcript after a backend flip.
 */
export async function closeConversationPane(name: string): Promise<void> {
  const [{ closeAgentPane }, { resolveTerminalBackend }] = await Promise.all([
    import('../terminal-backends/launch.js'),
    import('../terminal-backends/registry.js'),
  ]);
  await closeAgentPane(name, resolveTerminalBackend('herdr'));
}
