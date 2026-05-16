import { stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { MemoryIdentity } from '@panctl/contracts';
import { getAgentRuntimeStateAsync, listRunningAgentsAsync, type AgentState } from '../agents.js';
import { sessionFilePath } from '../paths.js';
import { compressJsonlBuffer } from './compress.js';

export interface TranscriptEntry {
  agentId: string;
  sessionId: string;
  transcriptPath: string;
  identity: MemoryIdentity;
  harness: string;
  size: number;
  mtimeMs: number;
}

export interface TurnEvent {
  compressedText: string;
  eventsConsumed: number;
  lastFullLineOffset: number;
}

export interface TranscriptSource {
  readonly harness: string;
  getActiveTranscripts(): Promise<TranscriptEntry[]>;
  parseDelta(buffer: Buffer | string, fromOffset?: number): TurnEvent[];
}

type RunningAgent = AgentState & { tmuxActive: boolean };

interface ClaudeCodeTranscriptSourceOptions {
  listAgents?: () => Promise<RunningAgent[]>;
  getRuntimeState?: (agentId: string) => Promise<{ claudeSessionId?: string } | null>;
  resolveTranscriptPath?: (workspace: string, sessionId: string) => string;
  statTranscript?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
}

export class ClaudeCodeTranscriptSource implements TranscriptSource {
  readonly harness = 'claude-code';

  private readonly listAgents: () => Promise<RunningAgent[]>;
  private readonly getRuntimeState: (agentId: string) => Promise<{ claudeSessionId?: string } | null>;
  private readonly resolveTranscriptPath: (workspace: string, sessionId: string) => string;
  private readonly statTranscript: (path: string) => Promise<{ size: number; mtimeMs: number }>;

  constructor(options: ClaudeCodeTranscriptSourceOptions = {}) {
    this.listAgents = options.listAgents ?? listRunningAgentsAsync;
    this.getRuntimeState = options.getRuntimeState ?? getAgentRuntimeStateAsync;
    this.resolveTranscriptPath = options.resolveTranscriptPath ?? sessionFilePath;
    this.statTranscript = options.statTranscript ?? stat;
  }

  async getActiveTranscripts(): Promise<TranscriptEntry[]> {
    const agents = await this.listAgents();
    const entries = await Promise.all(
      agents
        .filter((agent) => agent.tmuxActive && agent.status === 'running' && (agent.harness ?? 'claude-code') === 'claude-code')
        .map((agent) => this.resolveAgentTranscript(agent)),
    );
    return entries.filter((entry): entry is TranscriptEntry => entry !== null);
  }

  parseDelta(buffer: Buffer | string, fromOffset = 0): TurnEvent[] {
    const compressed = compressJsonlBuffer(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : buffer, fromOffset);
    if (compressed.eventsConsumed === 0) return [];
    return [{
      compressedText: compressed.text,
      eventsConsumed: compressed.eventsConsumed,
      lastFullLineOffset: compressed.lastFullLineOffset,
    }];
  }

  private async resolveAgentTranscript(agent: RunningAgent): Promise<TranscriptEntry | null> {
    const sessionId = agent.sessionId ?? (await this.getRuntimeState(agent.id))?.claudeSessionId;
    if (!sessionId) return null;

    const transcriptPath = this.resolveTranscriptPath(agent.workspace, sessionId);
    let fileStat: { size: number; mtimeMs: number };
    try {
      fileStat = await this.statTranscript(transcriptPath);
    } catch {
      return null;
    }

    return {
      agentId: agent.id,
      sessionId,
      transcriptPath,
      identity: buildMemoryIdentity(agent, sessionId),
      harness: 'claude-code',
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    };
  }
}

export class PiTranscriptSource implements TranscriptSource {
  readonly harness = 'pi';

  async getActiveTranscripts(): Promise<TranscriptEntry[]> {
    return [];
  }

  parseDelta(): TurnEvent[] {
    return [];
  }
}

export class TranscriptSourceRegistry {
  private readonly sources = new Map<string, TranscriptSource>();

  register(source: TranscriptSource): void {
    this.sources.set(source.harness, source);
  }

  get(harness: string): TranscriptSource | undefined {
    return this.sources.get(harness);
  }

  getAll(): TranscriptSource[] {
    return Array.from(this.sources.values());
  }

  async getActiveTranscripts(): Promise<TranscriptEntry[]> {
    const entries = await Promise.all(this.getAll().map((source) => source.getActiveTranscripts()));
    return entries.flat();
  }
}

export function createDefaultTranscriptSourceRegistry(): TranscriptSourceRegistry {
  const registry = new TranscriptSourceRegistry();
  registry.register(new ClaudeCodeTranscriptSource());
  registry.register(new PiTranscriptSource());
  return registry;
}

const defaultTranscriptSourceRegistry = createDefaultTranscriptSourceRegistry();

export function getTranscriptSourceRegistry(): TranscriptSourceRegistry {
  return defaultTranscriptSourceRegistry;
}

export async function getActiveTranscriptEntries(
  registry: TranscriptSourceRegistry = defaultTranscriptSourceRegistry,
): Promise<TranscriptEntry[]> {
  return registry.getActiveTranscripts();
}

function buildMemoryIdentity(agent: RunningAgent, sessionId: string): MemoryIdentity {
  return {
    projectId: inferProjectId(agent.workspace),
    workspaceId: basename(agent.workspace),
    issueId: agent.issueId,
    runId: agent.id,
    sessionId,
    agentRole: agent.role,
    agentHarness: 'claude-code',
  };
}

function inferProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return basename(workspacePath);
}
