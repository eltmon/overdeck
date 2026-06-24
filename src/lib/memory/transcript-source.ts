import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import type { MemoryIdentity } from '@overdeck/contracts';
import { Effect } from 'effect';
import {
  getAgentDir,
  getAgentRuntimeState,
  listRunningAgents,
  type AgentState,
} from '../agents.js';
import { sessionFilePath } from '../paths.js';
import { extractPiTranscript, extractCodexTranscript } from '../session-format-converter.js';
import { findRolloutPath, writeThreadId as _writeThreadId } from '../runtimes/codex.js';
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
  isSubagentSession?: (sessionId: string, agent: RunningAgent, transcriptPath: string) => boolean | Promise<boolean>;
}

interface PiTranscriptSourceOptions {
  listAgents?: () => Promise<RunningAgent[]>;
  readSessionId?: (agent: RunningAgent) => Promise<string | null>;
  resolveTranscriptPath?: (agent: RunningAgent, sessionId: string) => Promise<string | null>;
  statTranscript?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
}

export class ClaudeCodeTranscriptSource implements TranscriptSource {
  readonly harness = 'claude-code';

  private readonly listAgents: () => Promise<RunningAgent[]>;
  private readonly getRuntimeState: (agentId: string) => Promise<{ claudeSessionId?: string } | null>;
  private readonly resolveTranscriptPath: (workspace: string, sessionId: string) => string;
  private readonly statTranscript: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  private readonly isSubagentSession: (sessionId: string, agent: RunningAgent, transcriptPath: string) => boolean | Promise<boolean>;

  constructor(options: ClaudeCodeTranscriptSourceOptions = {}) {
    this.listAgents = options.listAgents ?? listRunningAgentsFromStore;
    this.getRuntimeState = options.getRuntimeState ?? getAgentRuntimeStateFromStore;
    this.resolveTranscriptPath = options.resolveTranscriptPath ?? sessionFilePath;
    this.statTranscript = options.statTranscript ?? stat;
    this.isSubagentSession = options.isSubagentSession ?? isClaudeCodeSubagentSession;
  }

  async getActiveTranscripts(): Promise<TranscriptEntry[]> {
    const agents = await this.listAgents();
    const entries = await Promise.all(
      agents
        .filter((agent) => agent.tmuxActive && agent.status === 'running' && agent.role === 'work' && (agent.harness ?? 'claude-code') === 'claude-code')
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
    if (await this.isSubagentSession(sessionId, agent, transcriptPath)) return null;
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
  readonly harness = 'ohmypi';

  private readonly listAgents: () => Promise<RunningAgent[]>;
  private readonly readSessionId: (agent: RunningAgent) => Promise<string | null>;
  private readonly resolveTranscriptPath: (agent: RunningAgent, sessionId: string) => Promise<string | null>;
  private readonly statTranscript: (path: string) => Promise<{ size: number; mtimeMs: number }>;

  constructor(options: PiTranscriptSourceOptions = {}) {
    this.listAgents = options.listAgents ?? listRunningAgentsFromStore;
    this.readSessionId = options.readSessionId ?? readPiSessionId;
    this.resolveTranscriptPath = options.resolveTranscriptPath ?? resolvePiTranscriptPath;
    this.statTranscript = options.statTranscript ?? stat;
  }

  async getActiveTranscripts(): Promise<TranscriptEntry[]> {
    const agents = await this.listAgents();
    const entries = await Promise.all(
      agents
        .filter((agent) => agent.tmuxActive && agent.status === 'running' && agent.role === 'work' && agent.harness === 'ohmypi')
        .map((agent) => this.resolveAgentTranscript(agent)),
    );
    return entries.filter((entry): entry is TranscriptEntry => entry !== null);
  }

  parseDelta(buffer: Buffer | string, fromOffset = 0): TurnEvent[] {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : buffer;
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) return [];

    const complete = text.slice(0, lastNewline + 1);
    const turns = extractPiTranscript(complete);
    if (turns.length === 0) return [];

    return [{
      compressedText: turns.map((turn) => `${turn.role === 'user' ? 'U' : 'A'}: ${turn.text}`).join('\n'),
      eventsConsumed: turns.length,
      lastFullLineOffset: fromOffset + Buffer.byteLength(complete, 'utf8'),
    }];
  }

  private async resolveAgentTranscript(agent: RunningAgent): Promise<TranscriptEntry | null> {
    const sessionId = await this.readSessionId(agent);
    if (!sessionId) return null;

    const transcriptPath = await this.resolveTranscriptPath(agent, sessionId);
    if (!transcriptPath) return null;

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
      harness: 'ohmypi',
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    };
  }
}

export class CodexTranscriptSource implements TranscriptSource {
  readonly harness = 'codex';

  private readonly listAgents: () => Promise<RunningAgent[]>;
  private readonly readThreadId: (agent: RunningAgent) => Promise<string | null>;
  private readonly statTranscript: (path: string) => Promise<{ size: number; mtimeMs: number }>;

  constructor(options: {
    listAgents?: () => Promise<RunningAgent[]>;
    readThreadId?: (agent: RunningAgent) => Promise<string | null>;
    statTranscript?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  } = {}) {
    this.listAgents = options.listAgents ?? listRunningAgentsFromStore;
    this.readThreadId = options.readThreadId ?? readCodexThreadId;
    this.statTranscript = options.statTranscript ?? stat;
  }

  async getActiveTranscripts(): Promise<TranscriptEntry[]> {
    const agents = await this.listAgents();
    const entries = await Promise.all(
      agents
        .filter((agent) => agent.tmuxActive && agent.status === 'running' && agent.role === 'work' && agent.harness === 'codex')
        .map((agent) => this.resolveAgentTranscript(agent)),
    );
    return entries.filter((entry): entry is TranscriptEntry => entry !== null);
  }

  parseDelta(buffer: Buffer | string, fromOffset = 0): TurnEvent[] {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : buffer;
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) return [];

    const complete = text.slice(0, lastNewline + 1);
    const turns = extractCodexTranscript(complete);
    if (turns.length === 0) return [];

    return [{
      compressedText: turns.map((turn) => `${turn.role === 'user' ? 'U' : 'A'}: ${turn.text}`).join('\n'),
      eventsConsumed: turns.length,
      lastFullLineOffset: fromOffset + Buffer.byteLength(complete, 'utf8'),
    }];
  }

  private async resolveAgentTranscript(agent: RunningAgent): Promise<TranscriptEntry | null> {
    const threadId = await this.readThreadId(agent);
    if (!threadId) return null;

    // Use per-agent CODEX_HOME, not the global ~/.codex; rollouts are written to
    // ~/.overdeck/agents/<id>/codex-home/sessions/ by the per-agent spawn.
    const rolloutPath = findRolloutPath(join(getAgentDir(agent.id), 'codex-home'), threadId);
    if (!rolloutPath) return null;

    let fileStat: { size: number; mtimeMs: number };
    try {
      fileStat = await this.statTranscript(rolloutPath);
    } catch {
      return null;
    }

    return {
      agentId: agent.id,
      sessionId: threadId,
      transcriptPath: rolloutPath,
      identity: buildMemoryIdentity(agent, threadId),
      harness: 'codex',
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    };
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
  registry.register(new CodexTranscriptSource());
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

function listRunningAgentsFromStore(): Promise<RunningAgent[]> {
  return Effect.runPromise(listRunningAgents());
}

function getAgentRuntimeStateFromStore(agentId: string): Promise<{ claudeSessionId?: string } | null> {
  return Effect.runPromise(getAgentRuntimeState(agentId));
}

async function readPiSessionId(agent: RunningAgent): Promise<string | null> {
  if (agent.sessionId) return agent.sessionId;
  try {
    const saved = (await readFile(join(getAgentDir(agent.id), 'session.id'), 'utf8')).trim();
    return saved || null;
  } catch {
    return null;
  }
}

async function resolvePiTranscriptPath(agent: RunningAgent, sessionId: string): Promise<string | null> {
  const sessionDir = join(getAgentDir(agent.id), 'sessions');
  let entries: string[];
  try {
    entries = (await readdir(sessionDir)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch {
    return null;
  }

  const matching = entries.findLast((name) => name.includes(sessionId));
  if (matching) return join(sessionDir, matching);
  return entries.length > 0 ? join(sessionDir, entries[entries.length - 1]!) : null;
}

function isClaudeCodeSubagentSession(_sessionId: string, _agent: RunningAgent, transcriptPath: string): boolean {
  return transcriptPath.split(sep).includes('subagents') || transcriptPath.includes('/subagents/');
}

function buildMemoryIdentity(agent: RunningAgent, sessionId: string): MemoryIdentity {
  return {
    projectId: inferProjectId(agent.workspace),
    workspaceId: basename(agent.workspace),
    issueId: agent.issueId,
    runId: agent.id,
    sessionId,
    agentRole: agent.role,
    agentHarness: agent.harness ?? 'claude-code',
  };
}

function inferProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return basename(workspacePath);
}

async function readCodexThreadId(agent: RunningAgent): Promise<string | null> {
  try {
    const threadIdPath = join(getAgentDir(agent.id), 'codex-thread-id');
    const saved = (await readFile(threadIdPath, 'utf8')).trim();
    return saved || null;
  } catch {
    return null;
  }
}
