import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentSnapshot, SessionNode, SessionNodePresence } from '@overdeck/contracts';

import {
  getAgentDir,
  getAgentStateSync,
  type AgentState,
} from '../../../lib/agents.js';
import type { AwaitingInputDetection } from '../../../lib/agent-input-detection.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import type { ReviewStatus } from '../../../lib/review-status.js';
import { normalizeAgentStatus } from '../services/agent-status.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import { buildReviewerNodes, readSynthesisRounds } from './reviewer-tree.js';

export function awaitingInputFromProjection(
  agentId: string,
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>,
): AwaitingInputDetection | null | undefined {
  const agent = agentSnapshotsById?.get(agentId);
  if (!agent) return undefined;
  if (agent.hasPendingQuestion !== true) return null;
  return {
    reason: (agent.pendingQuestionReason as AwaitingInputDetection['reason'] | undefined) ?? 'other',
    prompt: agent.pendingQuestionPrompt || 'Agent is waiting for human input',
  };
}

export async function readSessionGateFields(
  sessionId: string,
  state: AgentState | null = getAgentStateSync(sessionId),
): Promise<{
  paused?: true;
  pausedReason?: string;
  pausedAt?: string;
  troubled?: true;
  troubledAt?: string;
  troubledReason?: string;
  consecutiveFailures?: number;
  queuedMailCount?: number;
}> {
  if (!state) return {};
  return {
    paused: state.paused === true ? true : undefined,
    pausedReason: state.paused === true ? state.pausedReason : undefined,
    pausedAt: state.paused === true ? state.pausedAt : undefined,
    troubled: state.troubled === true ? true : undefined,
    troubledAt: state.troubled === true ? state.troubledAt : undefined,
    troubledReason: state.troubled === true ? state.lastFailureReason : undefined,
    consecutiveFailures: state.troubled === true ? state.consecutiveFailures : undefined,
    queuedMailCount: state.troubled === true ? await countQueuedMail(sessionId) : undefined,
  };
}

async function countQueuedMail(agentId: string): Promise<number> {
  try {
    const entries = await readdir(join(getAgentDir(agentId), 'mail'), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

interface BuildSpecialistSessionNodesOptions {
  issueId: string;
  fallbackProjectKey: string;
  workspacePath: string;
  projectPath: string;
  tmuxSessionNames: ReadonlySet<string>;
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>;
  centralStatus: ReviewStatus | null;
}

function isActiveStatus(status: string, activeStatus: string): boolean {
  return status === activeStatus || status === 'running' || status === 'starting';
}

/** Build review/test rows from live resource sessions first, with review-status
 * history as durable enrichment rather than an existence gate. */
export async function buildSpecialistSessionNodes(
  options: BuildSpecialistSessionNodesOptions,
): Promise<SessionNode[]> {
  const {
    issueId,
    fallbackProjectKey,
    workspacePath,
    projectPath,
    tmuxSessionNames,
    agentSnapshotsById,
    centralStatus,
  } = options;
  const issueLower = issueId.toLowerCase();
  const statusHistory = centralStatus?.history ?? [];
  const sections: SessionNode[] = [];

  const latestReview = statusHistory.filter((entry) => entry.type === 'review').at(-1);
  const reviewSessionName = `agent-${issueLower}-review`;
  const reviewIsLive = tmuxSessionNames.has(reviewSessionName);
  if (latestReview || reviewIsLive) {
    const projectKey = resolveProjectFromIssueSync(issueId)?.projectKey ?? fallbackProjectKey;
    const state = getAgentStateSync(reviewSessionName);
    const rawStatus = latestReview?.status ?? centralStatus?.reviewStatus ?? state?.status ?? 'reviewing';
    const active = isActiveStatus(rawStatus, 'reviewing');
    const status = normalizeAgentStatus(active ? 'running' : rawStatus);
    const startedAt = latestReview?.timestamp ?? state?.startedAt ?? centralStatus?.updatedAt ?? new Date(0).toISOString();
    const jsonlPath = await resolveJsonlPath(reviewSessionName, workspacePath);
    const awaitingInput = awaitingInputFromProjection(reviewSessionName, agentSnapshotsById);
    const snapshot = agentSnapshotsById?.get(reviewSessionName);
    const presence: SessionNodePresence = reviewIsLive ? (active ? 'active' : 'idle') : 'ended';

    sections.push({
      type: 'review',
      sessionId: reviewSessionName,
      model: state?.model || 'specialist',
      harness: state?.harness,
      startedAt,
      endedAt: reviewIsLive ? undefined : state?.stoppedAt,
      duration: 0,
      status,
      presence,
      roundMetadata: await readSynthesisRounds(issueId, projectKey) as SessionNode['roundMetadata'],
      awaitingInput: awaitingInput !== undefined ? awaitingInput !== null : false,
      awaitingInputPrompt: awaitingInput?.prompt,
      awaitingInputReason: awaitingInput?.reason,
      pendingInputKinds: snapshot?.pendingInputKinds ? [...snapshot.pendingInputKinds] : undefined,
      hasJsonl: !!jsonlPath,
      tmuxSession: reviewIsLive ? reviewSessionName : undefined,
      ...await readSessionGateFields(reviewSessionName, state),
    });
    const reviewerNodes = await buildReviewerNodes({
      issueId,
      projectKey,
      workspacePath,
      projectPath,
      tmuxSessionNames,
      startedAt,
      endedAt: reviewIsLive ? undefined : state?.stoppedAt,
      status,
      agentSnapshotsById,
    });
    sections.push(...(reviewerNodes as unknown as SessionNode[]));
  }

  const latestTest = statusHistory.filter((entry) => entry.type === 'test').at(-1);
  const testSessionName = `agent-${issueLower}-test`;
  const testIsLive = tmuxSessionNames.has(testSessionName);
  if (latestTest || testIsLive) {
    const state = getAgentStateSync(testSessionName);
    const rawStatus = latestTest?.status ?? centralStatus?.testStatus ?? state?.status ?? 'testing';
    const active = isActiveStatus(rawStatus, 'testing');
    const jsonlPath = await resolveJsonlPath(testSessionName, workspacePath);
    const awaitingInput = awaitingInputFromProjection(testSessionName, agentSnapshotsById);
    const snapshot = agentSnapshotsById?.get(testSessionName);
    sections.push({
      type: 'test',
      sessionId: testSessionName,
      model: state?.model || 'specialist',
      harness: state?.harness,
      startedAt: latestTest?.timestamp ?? state?.startedAt ?? centralStatus?.updatedAt ?? new Date(0).toISOString(),
      endedAt: testIsLive ? undefined : state?.stoppedAt,
      duration: 0,
      status: normalizeAgentStatus(active ? 'running' : rawStatus),
      presence: testIsLive ? (active ? 'active' : 'idle') : 'ended',
      awaitingInput: awaitingInput !== undefined ? awaitingInput !== null : false,
      awaitingInputPrompt: awaitingInput?.prompt,
      awaitingInputReason: awaitingInput?.reason,
      pendingInputKinds: snapshot?.pendingInputKinds ? [...snapshot.pendingInputKinds] : undefined,
      hasJsonl: !!jsonlPath,
      tmuxSession: testIsLive ? testSessionName : undefined,
      ...await readSessionGateFields(testSessionName, state),
    });
  }

  return sections;
}
