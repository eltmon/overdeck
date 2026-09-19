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
import type { BackendPane, DerivedIssueState } from '@overdeck/contracts';
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

interface BuildSpecialistSessionNodesOptions {
  issueId: string;
  fallbackProjectKey: string;
  workspacePath: string;
  projectPath: string;
  tmuxSessionNames: ReadonlySet<string>;
  agentSnapshotsById?: ReadonlyMap<string, AgentSnapshot>;
  /**
   * PAN-3917: the issue's derived state (FR-6). Replaces the review-status row
   * this builder used to read for existence and for the row's status.
   */
  derived: DerivedIssueState | null;
  /** Live panes in the issue's workspace (FR-5). Rows are panes. */
  panes?: readonly BackendPane[];
}
/**
 * Build the Review and Test rows of an issue tree.
 *
 * PAN-3917 FR-5: a row exists because a pane for that role exists in the
 * issue's workspace, or because the PR shows the issue reached that phase.
 * There is no review-status row and no status history to read.
 */
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
    derived,
    panes = [],
  } = options;
  const issueLower = issueId.toLowerCase();
  const sections: SessionNode[] = [];

  const paneFor = (role: BackendPane['role']): BackendPane | undefined =>
    panes.find((pane) => pane.role === role && pane.state !== 'exited');

  // The issue reached review once a PR exists; the PR's own review state says
  // how it went.
  const reachedReview = derived?.pr !== undefined;
  const reviewSessionName = `agent-${issueLower}-review`;
  const reviewPane = paneFor('review');
  const reviewIsLive = reviewPane !== undefined || tmuxSessionNames.has(reviewSessionName);

  if (reachedReview || reviewIsLive) {
    const projectKey = resolveProjectFromIssueSync(issueId)?.projectKey ?? fallbackProjectKey;
    const state = getAgentStateSync(reviewSessionName);
    const status = normalizeAgentStatus(
      reviewIsLive
        ? 'running'
        : derived?.pr?.reviewState === 'approved'
          ? 'passed'
          : derived?.pr?.reviewState === 'changes-requested'
            ? 'blocked'
            : 'reviewing',
    );
    const startedAt = reviewPane?.stateSince
      ? new Date(reviewPane.stateSince).toISOString()
      : state?.startedAt ?? new Date(0).toISOString();
    const jsonlPath = await resolveJsonlPath(reviewSessionName, workspacePath);
    const awaitingInput = awaitingInputFromProjection(reviewSessionName, agentSnapshotsById);
    const snapshot = agentSnapshotsById?.get(reviewSessionName);
    const presence: SessionNodePresence = reviewIsLive
      ? (reviewPane?.state === 'idle' ? 'idle' : 'active')
      : 'ended';

    sections.push({
      type: 'review',
      sessionId: reviewSessionName,
      model: (reviewPane?.model && reviewPane.model !== 'unknown' ? reviewPane.model : state?.model) || 'specialist',
      harness: (reviewPane?.harness && reviewPane.harness !== 'unknown' ? reviewPane.harness : state?.harness),
      startedAt,
      endedAt: reviewIsLive ? undefined : state?.stoppedAt,
      duration: 0,
      status,
      presence,
      roundMetadata: await readSynthesisRounds(issueId, projectKey) as SessionNode['roundMetadata'],
      awaitingInput: awaitingInput !== undefined ? awaitingInput !== null : reviewPane?.state === 'blocked',
      awaitingInputPrompt: awaitingInput?.prompt,
      awaitingInputReason: awaitingInput?.reason,
      pendingInputKinds: snapshot?.pendingInputKinds ? [...snapshot.pendingInputKinds] : undefined,
      hasJsonl: !!jsonlPath,
      tmuxSession: reviewIsLive ? (reviewPane?.terminalId ?? reviewSessionName) : undefined,
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

  const testSessionName = `agent-${issueLower}-test`;
  const testPane = paneFor('test');
  const testIsLive = testPane !== undefined || tmuxSessionNames.has(testSessionName);
  // Checks are the test phase's durable evidence once the pane is gone.
  const reachedTest = derived?.pr?.checks !== undefined && derived.pr.checks !== 'pending';

  if (reachedTest || testIsLive) {
    const state = getAgentStateSync(testSessionName);
    const jsonlPath = await resolveJsonlPath(testSessionName, workspacePath);
    const awaitingInput = awaitingInputFromProjection(testSessionName, agentSnapshotsById);
    const snapshot = agentSnapshotsById?.get(testSessionName);
    sections.push({
      type: 'test',
      sessionId: testSessionName,
      model: (testPane?.model && testPane.model !== 'unknown' ? testPane.model : state?.model) || 'specialist',
      harness: (testPane?.harness && testPane.harness !== 'unknown' ? testPane.harness : state?.harness),
      startedAt: testPane?.stateSince
        ? new Date(testPane.stateSince).toISOString()
        : state?.startedAt ?? new Date(0).toISOString(),
      endedAt: testIsLive ? undefined : state?.stoppedAt,
      duration: 0,
      status: normalizeAgentStatus(
        testIsLive ? 'running' : derived?.pr?.checks === 'green' ? 'passed' : 'failed',
      ),
      presence: testIsLive ? (testPane?.state === 'idle' ? 'idle' : 'active') : 'ended',
      awaitingInput: awaitingInput !== undefined ? awaitingInput !== null : testPane?.state === 'blocked',
      awaitingInputPrompt: awaitingInput?.prompt,
      awaitingInputReason: awaitingInput?.reason,
      pendingInputKinds: snapshot?.pendingInputKinds ? [...snapshot.pendingInputKinds] : undefined,
      hasJsonl: !!jsonlPath,
      tmuxSession: testIsLive ? (testPane?.terminalId ?? testSessionName) : undefined,
    });
  }

  return sections;
}
