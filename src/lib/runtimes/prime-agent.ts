import { statSync } from 'node:fs';
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

const unconfiguredController: PrimeAgentRuntimeController = {
  async spawn() { throw new Error('Prime Agent RPC controller is not configured'); },
  async send() { throw new Error('Prime Agent RPC controller is not configured'); },
  async abort() { return undefined; },
  async terminate() { return undefined; },
  async isRunning() { return false; },
  stats() { return null; },
  lastEventAt() { return null; },
  sessionPath() { return null; },
};

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
    this.controller = options.controller ?? unconfiguredController;
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
