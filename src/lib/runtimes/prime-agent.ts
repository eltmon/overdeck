import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentState } from '../agents.js';
import { getAgentStateSync, listAgentStates } from '../agents.js';
import { getRuntimeBehavior } from './behavior.js';
import type {
  Agent,
  AgentRuntimeSync,
  CostBreakdown,
  HarnessBehavior,
  Heartbeat,
  Session,
  SpawnConfig,
  TokenUsage,
} from './types.js';
import { getAgentDir } from '../agents/agent-state.js';
import { deliverPrimeAgentMessage, postPrimeAgentHost } from '../prime-agent/session-controller.js';
import { tmuxKillSession, tmuxSessionExists } from './tmux-cli.js';
import { tmuxCreateSession } from './tmux-cli.js';
import { getProviderAuthMode } from '../agents/provider-auth.js';
import { buildPrimeAgentBaseCommand } from '../prime-agent/launch-command.js';
import { loadConfigSync } from '../config-yaml.js';

export interface PrimeAgentSessionStats {
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  cost?: number;
}

export interface PrimeAgentRuntimeController {
  spawn(config: SpawnConfig): Promise<{ sessionId: string; sessionPath: string }>;
  send(agentId: string, message: string): Promise<void>;
  abort(agentId: string): Promise<void>;
  terminate(agentId: string): Promise<void>;
  isRunning(agentId: string): Promise<boolean>;
  stats(agentId: string): PrimeAgentSessionStats | null;
  lastEventAt(agentId: string): Date | null;
  sessionPath(agentId: string): string | null;
}

const productionController: PrimeAgentRuntimeController = {
  async spawn(config) {
    if (!config.model) throw new Error('Prime Agent spawn requires a model');
    const startupTimeoutMs = loadConfigSync().config.primeAgent.rpcStartupTimeoutMs;
    const authMode = await getProviderAuthMode(config.model);
    if (!authMode) throw new Error(`Prime Agent provider credentials are unavailable for ${config.model}`);
    let command = await buildPrimeAgentBaseCommand({ agentId: config.agentId, model: config.model, workspace: config.workspace, authMode, rpcStartupTimeoutMs: startupTimeoutMs });
    if (config.sessionId) command += ` --resume ${shellQuote(config.sessionId)}`;
    if (config.prompt) command += ` --prompt ${shellQuote(config.prompt)}`;
    rmSync(join(getAgentDir(config.agentId), 'prime-agent-session-id'), { force: true }); // PAN-3357: not a dir removal
    rmSync(join(getAgentDir(config.agentId), 'prime-agent-launch-error'), { force: true }); // PAN-3357: not a dir removal
    await tmuxCreateSession(config.agentId, config.workspace, command, { ...config.env, OVERDECK_AGENT_ID: config.agentId });
    try {
      const deadline = Date.now() + startupTimeoutMs;
      while (Date.now() < deadline) {
        const sessionId = readText(config.agentId, 'prime-agent-session-id');
        if (sessionId) return { sessionId, sessionPath: readText(config.agentId, 'prime-agent-session-path') ?? '' };
        const launchError = readText(config.agentId, 'prime-agent-launch-error');
        if (launchError) throw new Error(`Prime Agent host failed to start: ${launchError}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Prime Agent host did not become ready for ${config.agentId}`);
    } catch (error) {
      if (await tmuxSessionExists(config.agentId)) await tmuxKillSession(config.agentId);
      throw error;
    }
  },
  async send(agentId, message) { await deliverPrimeAgentMessage(agentId, message); },
  async abort(agentId) { await postPrimeAgentHost(agentId, { op: 'abort' }); },
  async terminate(agentId) { await tmuxKillSession(agentId); },
  async isRunning(agentId) { return existsSync(join(getAgentDir(agentId), 'prime-agent-token')) && await tmuxSessionExists(agentId); },
  stats(agentId) { return readStats(agentId)?.stats ?? null; },
  lastEventAt(agentId) { const value = readStats(agentId)?.lastEventAt; return value ? new Date(value) : null; },
  sessionPath(agentId) { return readText(agentId, 'prime-agent-session-path'); },
};

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

function readText(agentId: string, file: string): string | null {
  try { return readFileSync(join(getAgentDir(agentId), file), 'utf8').trim() || null; } catch { return null; }
}

function readStats(agentId: string): { stats?: PrimeAgentSessionStats; lastEventAt?: string } | null {
  try { return JSON.parse(readFileSync(join(getAgentDir(agentId), 'prime-agent-stats.json'), 'utf8')) as { stats?: PrimeAgentSessionStats; lastEventAt?: string }; } catch { return null; }
}

export interface PrimeAgentRuntimeOptions {
  controller?: PrimeAgentRuntimeController;
  getAgentState?: (agentId: string) => AgentState | null;
  listAgentStates?: () => AgentState[];
}

export class PrimeAgentRuntimeSync implements AgentRuntimeSync {
  readonly name = 'prime-agent' as const;
  private readonly controller: PrimeAgentRuntimeController;
  private readonly resolveAgentState: (agentId: string) => AgentState | null;
  private readonly resolveAgentStates: () => AgentState[];

  constructor(options: PrimeAgentRuntimeOptions = {}) {
    this.controller = options.controller ?? productionController;
    this.resolveAgentState = options.getAgentState ?? getAgentStateSync;
    this.resolveAgentStates = options.listAgentStates ?? listAgentStates;
  }

  getHarnessBehavior(): HarnessBehavior { return getRuntimeBehavior('prime-agent'); }
  getSessionPath(agentId: string): string | null { return this.controller.sessionPath(agentId); }

  getLastActivity(agentId: string): Date | null {
    const live = this.controller.lastEventAt(agentId);
    if (live) return live;
    const path = this.getSessionPath(agentId);
    if (!path) return null;
    try { return statSync(path).mtime; } catch { return null; }
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    const live = this.controller.lastEventAt(agentId);
    if (live) return { timestamp: live, agentId, source: 'active-heartbeat', confidence: 'high' };
    const detached = this.getLastActivity(agentId);
    return detached ? { timestamp: detached, agentId, source: 'jsonl', confidence: 'medium' } : null;
  }

  getTokenUsage(agentId: string): TokenUsage | null {
    const tokens = this.controller.stats(agentId)?.tokens;
    if (!tokens) return null;
    return { inputTokens: tokens.input ?? 0, outputTokens: tokens.output ?? 0, cacheReadTokens: tokens.cacheRead, cacheWriteTokens: tokens.cacheWrite };
  }

  getSessionCost(agentId: string): CostBreakdown | null {
    const cost = this.controller.stats(agentId)?.cost;
    return cost === undefined ? null : { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: cost, currency: 'USD' };
  }

  getSessionMetrics(agentId: string) {
    const snapshot = readStats(agentId);
    const tokens = snapshot?.stats?.tokens;
    const cost = snapshot?.stats?.cost;
    return {
      lastActivity: snapshot?.lastEventAt ? new Date(snapshot.lastEventAt) : this.getLastActivity(agentId),
      tokenUsage: tokens ? { inputTokens: tokens.input ?? 0, outputTokens: tokens.output ?? 0, cacheReadTokens: tokens.cacheRead, cacheWriteTokens: tokens.cacheWrite } : null,
      cost: cost === undefined ? null : { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: cost, currency: 'USD' as const },
    };
  }

  sendMessage(agentId: string, message: string): Promise<void> { return this.controller.send(agentId, message); }

  async killAgent(agentId: string): Promise<void> {
    await this.controller.abort(agentId);
    await this.controller.terminate(agentId);
  }

  async spawnAgent(config: SpawnConfig): Promise<Agent> {
    const session = await this.controller.spawn(config);
    return { id: config.agentId, sessionId: session.sessionId, runtime: 'prime-agent', model: config.model ?? '', workspace: config.workspace, startedAt: new Date() };
  }

  listSessions(workspace?: string): Session[] {
    return this.resolveAgentStates().flatMap((state) => {
      if (state.harness !== 'prime-agent' || (workspace && state.workspace !== workspace) || !state.sessionId) return [];
      const lastActivity = this.getLastActivity(state.id);
      if (!lastActivity) return [];
      return [{ id: state.sessionId, agentId: state.id, workspace: state.workspace, model: state.model, startedAt: new Date(state.startedAt), lastActivity, tokenUsage: this.getTokenUsage(state.id) ?? { inputTokens: 0, outputTokens: 0 } }];
    });
  }

  isRunning(agentId: string): Promise<boolean> {
    return this.resolveAgentState(agentId)?.harness === 'prime-agent' ? this.controller.isRunning(agentId) : Promise.resolve(false);
  }
}

export function createPrimeAgentRuntimeSync(options?: PrimeAgentRuntimeOptions): PrimeAgentRuntimeSync {
  return new PrimeAgentRuntimeSync(options);
}
