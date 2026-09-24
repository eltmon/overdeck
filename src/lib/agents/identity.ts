import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { resolveBareNumericId } from '../issue-id.js';
import { AGENTS_DIR, getOverdeckHome } from '../paths.js';
import { hostTerminalBackendName } from '../terminal-backends/select.js';
import type { AgentState as BackendAgentState, TerminalBackendName } from '../terminal-backends/types.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';

function agentStateFilePath(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'state.json');
}

/**
 * Minimal directory scan for {@link resolveAgentTarget}'s issueId fallback.
 * Deliberately does not import agent-state.ts's full parse/typing (that would
 * close an identity.ts <-> agent-state.ts import cycle — agent-state.ts
 * already imports normalizeAgentId from here).
 */
function listAgentIssueIdsSync(): { id: string; issueId: string }[] {
  let entries: string[];
  try {
    entries = readdirSync(AGENTS_DIR);
  } catch {
    return [];
  }
  const out: { id: string; issueId: string }[] = [];
  for (const name of entries) {
    try {
      const raw = readFileSync(agentStateFilePath(name), 'utf8');
      const parsed = JSON.parse(raw) as { id?: unknown; issueId?: unknown };
      if (typeof parsed.issueId === 'string') {
        out.push({ id: typeof parsed.id === 'string' ? parsed.id : name, issueId: parsed.issueId });
      }
    } catch {
      // skip unreadable/unparsable state files
    }
  }
  return out;
}

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
// Singleton runners spawn under their own bare ID (spawnRun creates the tmux
// session and agent dir from the raw ID). They MUST be listed here so
// normalizeAgentId is a no-op for them — otherwise message delivery and state
// lookups would target `agent-<id>` and miss the real session (PAN-1866: the
// sequencer spawned but its prompt was delivered to a nonexistent
// `agent-sequencer-runner` pane, leaving the agent idle).
const SINGLETON_AGENT_IDS = new Set(['flywheel-orchestrator', 'sequencer-runner']);

/** Normalize agent ID: preserve known prefixes, add 'agent-' for bare issue IDs */
export function normalizeAgentId(agentId: string): string {
  if (SINGLETON_AGENT_IDS.has(agentId)) return agentId;
  if (AGENT_PREFIXES.some(p => agentId.startsWith(p))) {
    return agentId;
  }
  return `agent-${agentId.toLowerCase()}`;
}

/** True when the input is already a fully-qualified agent ID (known prefix or singleton), not an issue ID. */
export function isQualifiedAgentId(input: string): boolean {
  const lower = input.toLowerCase();
  return SINGLETON_AGENT_IDS.has(lower) || AGENT_PREFIXES.some(p => lower.startsWith(p));
}

function agentStateExistsSync(agentId: string): boolean {
  return existsSync(agentStateFilePath(agentId));
}

/**
 * Resolve a CLI-supplied agent target to an on-disk agent ID (PAN-1760).
 * Accepts bare numerics ("1148"), issue IDs ("PAN-1148"), and fully-qualified
 * agent IDs ("agent-pan-1148-ship", "strike-pan-1723", "inspect-pan-1744-x",
 * "flywheel-orchestrator"). For issue IDs, prefers the canonical work-agent
 * directory when present, then falls back to the single registered agent state
 * for that issue. If no single fallback exists, preserves the historical
 * canonical agent-* target.
 */
export function resolveAgentTarget(input: string): string | null {
  if (isQualifiedAgentId(input)) return input.toLowerCase();
  const issueId = resolveBareNumericId(input);
  if (!issueId) return null;

  const canonicalAgentId = normalizeAgentId(issueId);
  if (agentStateExistsSync(canonicalAgentId)) return canonicalAgentId;

  try {
    const wantedIssueId = issueId.toUpperCase();
    const matches = listAgentIssueIdsSync()
      .filter((agent) => agent.issueId.toUpperCase() === wantedIssueId)
      .map((agent) => agent.id);
    if (matches.length === 1) return matches[0].toLowerCase();
    return canonicalAgentId;
  } catch {
    return canonicalAgentId;
  }
}

/**
 * Get path to agent's ready signal file (written by SessionStart hook)
 */
function getReadySignalPath(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId, 'ready.json');
}

/**
 * Clear ready signal before spawning (clean slate)
 */
export function clearReadySignal(agentId: string): void {
  const readyPath = getReadySignalPath(agentId);
  if (existsSync(readyPath)) {
    try {
      unlinkSync(readyPath);
    } catch {
      // Ignore errors - non-critical
    }
  }
}

function isReadySignalPresent(readyPath: string): boolean {
  if (!existsSync(readyPath)) return false;
  try {
    const signal = JSON.parse(readFileSync(readyPath, 'utf-8'));
    // Accept both the Claude hook shape ({ ready: true, ... }) and the Pi
    // extension shape ({ agentId, sessionId, ... } with no `ready` field).
    return Boolean(signal && typeof signal === 'object' && signal.ready !== false);
  } catch {
    // File exists but mid-write / invalid — keep waiting.
    return false;
  }
}

export async function waitForReadySignal(agentId: string, timeoutSeconds = 30): Promise<boolean> {
  const readyPath = getReadySignalPath(agentId);

  for (let i = 0; i < timeoutSeconds; i++) {
    if (isReadySignalPresent(readyPath)) return true;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Non-blocking sleep
  }

  return isReadySignalPresent(readyPath);
}

/** Test seams for {@link waitForAgentIdle}. Production callers pass nothing. */
export interface WaitForAgentIdleDeps {
  /** Terminal backend the agent runs on. Defaults to the host's selection. */
  backend?: TerminalBackendName;
  /**
   * The backend's own state for the agent's pane, or undefined when it cannot
   * tell. Only consulted on Herdr; defaults to Herdr's `agent_status` read
   * through `probeHerdrAgentLiveness`.
   */
  probeBackendState?: (agentId: string) => Promise<BackendAgentState | undefined>;
}

async function probeHerdrAgentState(agentId: string): Promise<BackendAgentState | undefined> {
  const { probeHerdrAgentLiveness } = await import('../terminal-backends/herdr.js');
  const probe = await probeHerdrAgentLiveness(agentId);
  return probe.kind === 'alive' ? probe.state : undefined;
}

/**
 * Wait until a hook-instrumented agent reports it is idle at the prompt, via the
 * runtime mirror (Stop / SessionStart hook → activity 'idle'), or the timeout
 * elapses. Returns true if idle was observed.
 *
 * PAN-1594/1596: this is the hook-derived "is the agent idle right now" check.
 * It replaced the tmux pane-scrape `waitForClaudePrompt` (since removed). Works
 * for any hook-instrumented session — agents AND conversations (`conv-*`), which
 * feed the runtime mirror once their heartbeat POSTs authenticate (PAN-1596). No
 * dependency on tmux output or permission mode.
 *
 * PAN-4186: on Herdr the backend answers too. Herdr's `agent_status` for the
 * pane (`idle`, or `done` for a finished turn at its prompt) counts as idle;
 * `working`/`blocked` keep the wait going. When Herdr cannot tell (`unknown`,
 * a pane-bound host pane, a failed probe) the runtime mirror alone decides, as
 * on tmux.
 *
 * Distinct from waitForReadySignal: that answers the one-time "has this
 * (re)launched session reached the prompt" (ready.json gate, used by the
 * conversation reattach/fork paths); this answers "is the running agent idle at
 * the prompt right now".
 */
export async function waitForAgentIdle(
  agentId: string,
  timeoutMs = 5000,
  deps: WaitForAgentIdleDeps = {},
): Promise<boolean> {
  const backend = deps.backend ?? (await hostTerminalBackendName());
  const probeBackendState = backend === 'herdr' ? (deps.probeBackendState ?? probeHerdrAgentState) : null;
  const isIdleNow = async (): Promise<boolean> => {
    if (getAgentRuntimeStateSync(agentId)?.state === 'idle') return true;
    if (!probeBackendState) return false;
    const state = await probeBackendState(agentId).catch(() => undefined);
    return state === 'idle' || state === 'done';
  };
  const deadline = Date.now() + timeoutMs;
  do {
    if (await isIdleNow()) return true;
    await new Promise(r => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return isIdleNow();
}
