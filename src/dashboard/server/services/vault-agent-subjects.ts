/**
 * Session Vault pipeline-agent subjects (PAN-4647, PAN-2350 W-CONV6).
 *
 * The settle poller tracks managed conversations; this module adds every
 * Overdeck pipeline agent (any role with a state.json) inside the tracking
 * window: running or starting, or stopped less than AGENT_TRACK_AFTER_STOP_MS
 * ago. Each subject carries its transcript path, resolved through the one
 * authoritative resolver, and the title its record is minted with. The
 * subject name embeds the path, so a new session makes the old subject drop
 * out and the poller force-settles the old file once.
 */
import { listAgentStatesAsync, type AgentState } from '../../../lib/agents/agent-state-read.js';
import { resolveAgentTranscriptCandidate } from '../../../lib/agents/transcript-resolver.js';
import type { TranscriptCandidate } from '../../../lib/session-history.js';

export const AGENT_TRACK_AFTER_STOP_MS = 30 * 60_000;
export const AGENT_LIST_TTL_MS = 60_000;

export interface PipelineAgentSubject {
  /** `agent:<agentId>:<transcriptPath>` */
  name: string;
  harness: 'claude-code' | 'codex';
  transcriptPath: string;
  recordTitle: string;
  agentId: string;
}

export interface PipelineAgentSubjectDeps {
  listStates?: () => Promise<AgentState[]>;
  resolveTranscript?: (agentId: string, workspace: string) => Promise<TranscriptCandidate | null>;
  now?: () => number;
  ttlMs?: number;
}

export function pipelineAgentRecordTitle(state: Pick<AgentState, 'id' | 'issueId' | 'role'>): string {
  const issue = state.issueId?.trim();
  return issue ? `${issue} ${state.role} agent (${state.id})` : `${state.role} agent (${state.id})`;
}

export function isInTrackingWindow(state: Pick<AgentState, 'status' | 'stoppedAt' | 'lastActivity'>, nowMs: number): boolean {
  if (state.status === 'running' || state.status === 'starting') return true;
  const ended = Date.parse(state.stoppedAt ?? state.lastActivity ?? '');
  return Number.isFinite(ended) && nowMs - ended < AGENT_TRACK_AFTER_STOP_MS;
}

const HARNESS_BY_KIND: Partial<Record<TranscriptCandidate['kind'], PipelineAgentSubject['harness']>> = {
  claude: 'claude-code',
  codex: 'codex',
};

function warnOnce(warned: Set<string>, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[vault] agent subjects: ${message}`);
}

export function createPipelineAgentSubjectLister(deps: PipelineAgentSubjectDeps = {}): () => Promise<PipelineAgentSubject[]> {
  const listStates = deps.listStates ?? (() => listAgentStatesAsync({ skip: (name) => name.startsWith('conv-') || name.startsWith('ext-') }));
  const resolveTranscript = deps.resolveTranscript ?? ((agentId, workspace) => resolveAgentTranscriptCandidate(agentId, workspace));
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? AGENT_LIST_TTL_MS;
  const warned = new Set<string>();
  let cached: { at: number; states: AgentState[] } | null = null;

  async function getStates(nowMs: number): Promise<AgentState[]> {
    if (cached && nowMs - cached.at < ttlMs) return cached.states;
    try {
      const states = await listStates();
      cached = { at: nowMs, states };
      return states;
    } catch (error) {
      warnOnce(warned, error);
      return [];
    }
  }

  return async function listPipelineAgentSubjects(): Promise<PipelineAgentSubject[]> {
    const nowMs = now();
    const states = await getStates(nowMs);
    const subjects: PipelineAgentSubject[] = [];
    for (const state of states) {
      if (!isInTrackingWindow(state, nowMs)) continue;
      let candidate: TranscriptCandidate | null;
      try {
        candidate = await resolveTranscript(state.id, state.workspace);
      } catch (error) {
        warnOnce(warned, error);
        continue;
      }
      if (!candidate) continue;
      const harness = HARNESS_BY_KIND[candidate.kind];
      if (!harness) continue;
      subjects.push({
        name: `agent:${state.id}:${candidate.path}`,
        harness,
        transcriptPath: candidate.path,
        recordTitle: pipelineAgentRecordTitle(state),
        agentId: state.id,
      });
    }
    return subjects;
  };
}

/** The lister the poller uses by default. */
export const listPipelineAgentSubjects = createPipelineAgentSubjectLister();
