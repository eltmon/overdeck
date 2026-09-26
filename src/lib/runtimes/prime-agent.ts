/**
 * Prime Agent Cloister runtime (PAN-3668 WI-15, FR-9, FR-10, FR-12).
 *
 * Spawns through the terminal backend (`launchRuntimePane`), never tmux directly (D6).
 * Kill is ordered: best-effort `interrupt` over the host socket (≤ 5 s), a 1 s grace,
 * then the pane is closed and the private daemon is reaped, unconditionally (D3).
 * Heartbeat and last activity come from the host's `prime-agent-stats.json` while the
 * host socket exists, and from the session file's mtime once it is gone. Token usage and
 * cost come from the host's last `get_session_stats` snapshot.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getAgentState, saveAgentStateSync } from '../agents/agent-state.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { listAgentStates } from '../agents/queries.js';
import { waitForHostReady } from '../agents/runtime-command.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { getOverdeckHome } from '../paths.js';
import { reapPrimeAgentDaemon } from '../prime-agent/daemon.js';
import { postPrimeAgentHostOp } from '../prime-agent/host-client.js';
import { getPrimeAgentLauncherFields } from '../prime-agent/launcher-fields.js';
import { closeAgentPane, closeBackendPane, resolveLaunchBackend } from '../terminal-backends/launch.js';
import type { AgentPaneRef, TerminalBackend } from '../terminal-backends/types.js';
import { getRuntimeBehavior } from './behavior.js';
import { hostSessionIdFile, hostSocketPath } from './host-transport.js';
import { launchRuntimePane } from './runtime-pane-launch.js';
import { isRuntimeAgentAlive } from './runtime-liveness.js';
import { PRIME_AGENT_STATS_FILE, primeAgentSessionFilePointerPath, requirePrimeAgentSessionFile } from './storage/prime-agent.js';
import type { Agent, AgentRuntimeSync, CostBreakdown, Heartbeat, Session, SpawnConfig, TokenUsage } from './types.js';

export const PRIME_AGENT_KILL_GRACE_MS = 1_000;
export const PRIME_AGENT_INTERRUPT_TIMEOUT_MS = 5_000;
const READY_TIMEOUT_SECONDS = 60;

interface PrimeAgentStatsSnapshot {
  lastEventAt?: string;
  stats?: {
    tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    cost?: number;
  } | null;
}

export interface PrimeAgentRuntimeDeps {
  resolveBackend?: () => Promise<TerminalBackend>;
  launchPane?: typeof launchRuntimePane;
  waitReady?: (agentId: string) => Promise<void>;
  deliver?: typeof deliverAgentMessage;
  interrupt?: (agentId: string) => Promise<unknown>;
  closePane?: (agentId: string) => Promise<unknown>;
  reapDaemon?: (agentId: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  home?: () => string;
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, ms);
    promise.then(
      () => { clearTimeout(timer); resolvePromise(); },
      () => { clearTimeout(timer); resolvePromise(); },
    );
  });
}

export class PrimeAgentRuntimeSync implements AgentRuntimeSync {
  readonly name = 'prime-agent' as const;

  constructor(private readonly deps: PrimeAgentRuntimeDeps = {}) {}

  getHarnessBehavior() {
    return getRuntimeBehavior(this.name);
  }

  private home(): string {
    return (this.deps.home ?? getOverdeckHome)();
  }

  private agentsRoot(): string {
    return join(this.home(), 'agents');
  }

  private readStats(agentId: string): PrimeAgentStatsSnapshot | null {
    try {
      return JSON.parse(readFileSync(join(this.agentsRoot(), agentId, PRIME_AGENT_STATS_FILE), 'utf8')) as PrimeAgentStatsSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * The recorded session file. AgentRuntimeSync is synchronous by contract, so this
   * reads the pointer with sync fs; async callers use readPrimeAgentSessionFile.
   */
  getSessionPath(agentId: string): string | null {
    try {
      const sessionFile = readFileSync(primeAgentSessionFilePointerPath(agentId, this.agentsRoot()), 'utf8').trim();
      return sessionFile && statSync(sessionFile).isFile() ? sessionFile : null;
    } catch {
      return null;
    }
  }

  getLastActivity(agentId: string): Date | null {
    return this.getHeartbeat(agentId)?.timestamp ?? null;
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    if (existsSync(hostSocketPath(agentId, 'prime-agent', this.home()))) {
      const lastEventAt = this.readStats(agentId)?.lastEventAt;
      const timestamp = lastEventAt ? new Date(lastEventAt) : null;
      if (timestamp && !Number.isNaN(timestamp.getTime())) {
        return { timestamp, agentId, source: 'active-heartbeat', confidence: 'high' };
      }
    }
    const path = this.getSessionPath(agentId);
    if (!path) return null;
    try {
      return { timestamp: statSync(path).mtime, agentId, source: 'jsonl', confidence: 'medium' };
    } catch {
      return null;
    }
  }

  getTokenUsage(agentId: string): TokenUsage | null {
    const tokens = this.readStats(agentId)?.stats?.tokens;
    if (!tokens) return null;
    return {
      inputTokens: tokens.input ?? 0,
      outputTokens: tokens.output ?? 0,
      ...(tokens.cacheRead !== undefined ? { cacheReadTokens: tokens.cacheRead } : {}),
      ...(tokens.cacheWrite !== undefined ? { cacheWriteTokens: tokens.cacheWrite } : {}),
    };
  }

  /** Prime reports one session total; it has no per-token-type cost split, so the components are 0. */
  getSessionCost(agentId: string): CostBreakdown | null {
    const cost = this.readStats(agentId)?.stats?.cost;
    if (typeof cost !== 'number') return null;
    return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: cost, currency: 'USD' };
  }

  async sendMessage(agentId: string, message: string): Promise<void> {
    const result = await (this.deps.deliver ?? deliverAgentMessage)(agentId, message, 'prime-agent-runtime');
    if (!result.ok) throw new Error(result.failure ?? 'Prime Agent message delivery failed');
  }

  async killAgent(agentId: string): Promise<void> {
    const interrupt = this.deps.interrupt
      ?? ((id: string) => postPrimeAgentHostOp(id, { op: 'interrupt' }, PRIME_AGENT_INTERRUPT_TIMEOUT_MS, this.home()));
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)));
    try {
      await withTimeout(interrupt(agentId), PRIME_AGENT_INTERRUPT_TIMEOUT_MS);
      await sleep(PRIME_AGENT_KILL_GRACE_MS);
    } finally {
      await (this.deps.closePane ?? closeAgentPane)(agentId).catch(() => undefined);
      await (this.deps.reapDaemon ?? reapPrimeAgentDaemon)(agentId);
    }
  }

  async isRunning(agentId: string): Promise<boolean> {
    return isRuntimeAgentAlive(agentId, this.name);
  }

  async spawnAgent(config: SpawnConfig): Promise<Agent> {
    if (!config.model) throw new Error('Prime Agent requires an explicitly configured model');
    const backend = await (this.deps.resolveBackend ?? resolveLaunchBackend)();
    if (await this.isRunning(config.agentId)) throw new Error(`Agent ${config.agentId} is already running`);

    const launch = await prepareHarnessLaunch('prime-agent');
    const { fields, paneEnv } = await getPrimeAgentLauncherFields(config.agentId, config.model, config.workspace, launch.binaryPath, {
      effort: config.effort,
      resumeSessionFile: config.sessionId ? await requirePrimeAgentSessionFile(config.agentId, this.agentsRoot()) : undefined,
    });
    const dir = join(this.agentsRoot(), config.agentId);
    await mkdir(dir, { recursive: true });
    const launcher = join(dir, 'launcher.sh');
    await writeFile(launcher, generateLauncherScript({
      role: 'work',
      workingDir: config.workspace,
      overdeckEnv: { agentId: config.agentId },
      extraEnvExports: [launch.pathExport],
      ...fields,
    }), { mode: 0o700 });

    let pane: AgentPaneRef | null = null;
    try {
      pane = await (this.deps.launchPane ?? launchRuntimePane)({
        agentId: config.agentId,
        workspace: config.workspace,
        harness: 'prime-agent',
        model: config.model,
        launcherScript: launcher,
        env: { ...config.env, ...paneEnv },
        backend,
        state: getAgentState(config.agentId),
        saveState: saveAgentStateSync,
      });
      await (this.deps.waitReady ?? ((id: string) => waitForHostReady(id, 'prime-agent', READY_TIMEOUT_SECONDS)))(config.agentId);
      const sessionId = (await readFile(join(dir, hostSessionIdFile('prime-agent')), 'utf8')).trim();
      if (config.prompt) await this.sendMessage(config.agentId, config.prompt);
      return { id: config.agentId, sessionId, runtime: 'prime-agent', model: config.model, workspace: config.workspace, startedAt: new Date() };
    } catch (error) {
      await closeBackendPane(pane);
      await (this.deps.reapDaemon ?? reapPrimeAgentDaemon)(config.agentId).catch(() => undefined);
      throw error;
    }
  }

  listSessions(workspace?: string): Session[] {
    return listAgentStates()
      .filter((state) => state.harness === 'prime-agent' && (!workspace || state.workspace === workspace))
      .flatMap((state) => {
        const lastActivity = this.getLastActivity(state.id);
        const sessionId = this.readSessionId(state.id);
        if (!lastActivity || !sessionId) return [];
        return [{
          id: sessionId,
          agentId: state.id,
          workspace: state.workspace,
          model: state.model,
          startedAt: new Date(state.startedAt),
          lastActivity,
          tokenUsage: this.getTokenUsage(state.id) ?? { inputTokens: 0, outputTokens: 0 },
        }];
      });
  }

  private readSessionId(agentId: string): string | null {
    try {
      return readFileSync(join(this.agentsRoot(), agentId, hostSessionIdFile('prime-agent')), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
}

export function createPrimeAgentRuntime(deps: PrimeAgentRuntimeDeps = {}): PrimeAgentRuntimeSync {
  return new PrimeAgentRuntimeSync(deps);
}
