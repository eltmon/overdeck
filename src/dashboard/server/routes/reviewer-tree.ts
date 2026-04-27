/**
 * Reviewer-tree builder for the Command Deck (PAN-830).
 *
 * Given an issue, this module returns exactly five canonical reviewer nodes
 * (one per role: correctness, security, performance, requirements, synthesis)
 * regardless of how many review rounds have run. Each node carries the
 * aggregated round metadata read from
 * `~/.panopticon/agents/<canonical-session>/round-N.json` artifacts written
 * by `archiveReviewerRound` in review-agent.ts.
 *
 * The orchestrator (parent `review` node) is emitted by the caller; this
 * module is only responsible for the five role children.
 *
 * Async-only (fs/promises); safe to call from the dashboard server.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentStatus, SessionNodePresence } from '@panctl/contracts';
import { normalizeAgentStatus } from '../services/agent-status.js';
import {
  REVIEWER_ROLES,
  getReviewerSessionName,
  parseReviewerSessionName,
  type ReviewerRole,
} from '../../../lib/cloister/specialists.js';
import { resolveJsonlPath } from './jsonl-resolver.js';

export interface ReviewerRoundSummary {
  round: number;
  status: string;
  reviewResult?: string;
  success?: boolean;
  archivedAt?: string;
  /** Wall-clock start of the round (ISO 8601). */
  startedAt?: string;
  /** Wall-clock end of the round (ISO 8601, equal to archive time). */
  endedAt?: string;
  /** Round duration in seconds. Null when timestamps were missing/invalid in the artifact. */
  durationSec?: number | null;
  /** Number of findings reported by this round's synthesis (security + performance). */
  findings?: number;
  /** Round cost in USD; omitted when not yet tracked. */
  cost?: number;
}

export interface ReviewerRoundMetadata {
  roundCount: number;
  latestRound: number;
  latestStatus?: string;
  history: ReviewerRoundSummary[];
}

export interface ReviewerNode {
  type: 'reviewer';
  role: ReviewerRole;
  sessionId: string;
  tmuxSession?: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  duration: number | null;
  status: AgentStatus;
  transcript?: string;
  presence: SessionNodePresence;
  hasJsonl?: boolean;
  roundMetadata?: ReviewerRoundMetadata;
}

export interface BuildReviewerNodesOptions {
  issueId: string;
  projectKey: string;
  workspacePath: string;
  /** Project root path — reviewer sessions are spawned from here, so JSONL
   *  resolution should use this instead of the workspace path. */
  projectPath?: string;
  tmuxSessionNames: ReadonlySet<string>;
  /** Parent review section start time, used as fallback if there are no rounds. */
  startedAt: string;
  /** Parent review section end time. */
  endedAt?: string;
  /** Parent review section status. */
  status: string;
  /** Override the ~/.panopticon/agents directory (test hook). */
  agentsDirOverride?: string;
}

/**
 * Extract the reviewer role from a tmux session name. Supports both:
 *   - Canonical (PAN-830): `specialist-<projectKey>-<issueId>-review-<role>`
 *   - Legacy (PAN-821):    `review-<issueId>-<timestamp>-<role>`
 *
 * Returns the role string, or null if the name doesn't match either pattern.
 */
export function extractReviewerRole(tmuxName: string, issueId: string): string | null {
  // Canonical PAN-830 pattern first
  const canonical = parseReviewerSessionName(tmuxName);
  if (canonical && canonical.issueId.toLowerCase() === issueId.toLowerCase()) {
    return canonical.role;
  }

  // Legacy PAN-821 pattern: review-<issueId>-<timestamp>-<role>
  const prefix = `review-${issueId}-`;
  if (!tmuxName.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rest = tmuxName.slice(prefix.length);
  const dashIdx = rest.indexOf('-');
  if (dashIdx <= 0) return null;
  const role = rest.slice(dashIdx + 1);
  return role || null;
}

/** Read the round-N.json artifacts for one reviewer session. */
export async function readReviewerRounds(
  sessionName: string,
  agentsRoot: string,
): Promise<ReviewerRoundMetadata | undefined> {
  const dir = join(agentsRoot, sessionName);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }

  const roundFiles = entries
    .map(name => {
      const m = name.match(/^round-(\d+)\.json$/);
      return m ? { name, round: Number(m[1]) } : null;
    })
    .filter((x): x is { name: string; round: number } => x !== null)
    .sort((a, b) => a.round - b.round);

  if (roundFiles.length === 0) return undefined;

  const history = (await Promise.all(
    roundFiles.map(async (rf) => {
      const raw = await readFile(join(dir, rf.name), 'utf-8').catch(() => null);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as {
          round?: number;
          status?: string;
          reviewResult?: string;
          success?: boolean;
          archivedAt?: string;
          startedAt?: string;
          endedAt?: string;
          durationSec?: number | null;
          findings?: number;
          cost?: number;
        };
        return {
          round: parsed.round ?? rf.round,
          status: parsed.status ?? 'unknown',
          reviewResult: parsed.reviewResult,
          success: parsed.success,
          archivedAt: parsed.archivedAt,
          startedAt: parsed.startedAt,
          endedAt: parsed.endedAt,
          durationSec: parsed.durationSec,
          findings: parsed.findings,
          cost: parsed.cost,
        };
      } catch { /* skip malformed artifact */ return null; }
    }),
  )).filter((x): x is ReviewerRoundSummary => x !== null);

  if (history.length === 0) return undefined;

  const latest = history[history.length - 1]!;
  return {
    roundCount: history.length,
    latestRound: latest.round,
    latestStatus: latest.status,
    history,
  };
}

/**
 * Build exactly five canonical reviewer nodes for an issue. Order matches
 * REVIEWER_ROLES so synthesis is always last.
 */
export async function buildReviewerNodes(
  opts: BuildReviewerNodesOptions,
): Promise<ReviewerNode[]> {
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');

  const nodes = await Promise.all(
    REVIEWER_ROLES.map(async (role) => {
      const sessionId = getReviewerSessionName(role, opts.projectKey, opts.issueId);
      const isLive = opts.tmuxSessionNames.has(sessionId);
      const roundMetadata = await readReviewerRounds(sessionId, agentsRoot);
      // Reviewer sessions are spawned from the project root, not the workspace,
      // so JSONL resolution must use the project path (PAN-830 review high-7).
      const jsonlCwd = opts.projectPath ?? opts.workspacePath;
      const jsonlPath = await resolveJsonlPath(sessionId, jsonlCwd, {
        agentsDirOverride: opts.agentsDirOverride,
      });

      // Presence:
      //   - live tmux session present → if parent review is running, 'active'; else 'idle'
      //   - no live tmux session present → 'ended'
      let presence: SessionNodePresence;
      if (isLive) {
        presence = opts.status === 'running' ? 'active' : 'idle';
      } else {
        presence = 'ended';
      }

      // Per-role status:
      //   - if the tmux session is alive, the reviewer is running NOW —
      //     round artifacts are from PREVIOUS rounds and stale
      //   - otherwise prefer the latest round artifact's status
      //   - fall back to the parent review section's status
      const rawStatus = isLive ? 'running' : (roundMetadata?.latestStatus ?? opts.status);
      const status = normalizeAgentStatus(rawStatus);

      const node: ReviewerNode = {
        type: 'reviewer',
        role,
        sessionId,
        // Expose tmux session name when live so the Terminal tab can attach
        tmuxSession: isLive ? sessionId : undefined,
        model: 'specialist',
        startedAt: opts.startedAt,
        endedAt: opts.endedAt,
        duration: opts.startedAt && opts.endedAt
          ? (() => {
              const ms = new Date(opts.endedAt).getTime() - new Date(opts.startedAt).getTime();
              return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
            })()
          : null,
        status,
        presence,
        hasJsonl: !!jsonlPath,
      };
      if (roundMetadata) node.roundMetadata = roundMetadata;
      return node;
    }),
  );

  return nodes;
}
