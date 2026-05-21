/**
 * Reviewer-tree builder for the Command Deck (PAN-830).
 *
 * Given an issue, this module returns exactly four canonical convoy reviewer
 * nodes (correctness, security, performance, requirements) regardless of how
 * many review rounds have run. Each node carries the
 * aggregated round metadata read from
 * `~/.panopticon/agents/<canonical-session>/round-N.json` artifacts written
 * by `archiveReviewerRound` in review-agent.ts.
 *
 * The orchestrator (parent `review` node) is emitted by the caller; this
 * module is only responsible for the four convoy children.
 *
 * Async-only (fs/promises); safe to call from the dashboard server.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentStatus, SessionNodePresence } from '@panctl/contracts';
import { normalizeAgentStatus } from '../services/agent-status.js';
import {
  getReviewerSessionName,
  parseReviewerSessionName,
  type ReviewerRole,
} from '../../../lib/cloister/specialists.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import { capturePaneAsync } from '../../../lib/tmux.js';

const CONVOY_REVIEWER_ROLES: readonly ReviewerRole[] = [
  'correctness',
  'security',
  'performance',
  'requirements',
];

const API_ERROR_PATTERNS = [
  /attempt\s+\d+\/\d+/i,
  /502\s+unknown\s+provider/i,
  /api\s+error/i,
  /rate\s+limit/i,
  /connection\s+refused/i,
  /ECONNREFUSED/,
  /overloaded/i,
];

async function detectApiError(sessionId: string): Promise<boolean> {
  try {
    const pane = await capturePaneAsync(sessionId, 15);
    return API_ERROR_PATTERNS.some(p => p.test(pane));
  } catch {
    return false;
  }
}

/**
 * Read the agent's own `stoppedAt` from `~/.panopticon/agents/<sessionId>/state.json`.
 *
 * Used to give each reviewer node its own end timestamp instead of inheriting the
 * parent review section's `endedAt` — sub-reviewers (correctness/security/...)
 * routinely finish minutes before the synthesizer's parent step closes, so the
 * parent's `endedAt` is null while the child has long stopped. Without a per-node
 * endedAt, the frontend's `synthesizedConversation` produces
 * `{ sessionAlive: false, endedAt: null }`, which `ConversationPanel.isSpawning`
 * interprets as "still spawning" and renders a "Starting…" placeholder over the
 * already-complete JSONL.
 */
async function readReviewerStoppedAt(
  sessionId: string,
  agentsRoot: string,
): Promise<string | undefined> {
  try {
    const raw = await readFile(join(agentsRoot, sessionId, 'state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { stoppedAt?: string };
    return typeof parsed.stoppedAt === 'string' ? parsed.stoppedAt : undefined;
  } catch {
    return undefined;
  }
}

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
  /** Summary text from synthesis.md (first ~500 chars). Only populated for
   *  the synthesis reviewer role. */
  summary?: string;
}

export interface ReviewerRoundMetadata {
  roundCount: number;
  latestRound: number;
  latestStatus?: string;
  latestReviewResult?: string;
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
 *   - Current (PAN-1048+): `agent-<issueId>-review-<role>`
 *   - Legacy (PAN-830):   `specialist-<projectKey>-<issueId>-review-<role>`
 *   - Legacy (PAN-821):   `review-<issueId>-<timestamp>-<role>`
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

  const isSynthesis = sessionName.endsWith('-review-synthesis');

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
          outputFile?: string;
        };

        // For synthesis rounds, read the summary from the output .md file
        // so the Findings tab can show what the review actually found.
        let summary: string | undefined;
        if (isSynthesis && parsed.outputFile) {
          try {
            const md = await readFile(parsed.outputFile, 'utf-8');
            // Extract everything up to the first "## Nits" or "## Cross-cutting"
            // or cap at 1500 chars — enough for verdict + blockers + high-priority.
            const cutoff = md.search(/^## (Nits|Cross-cutting|Low Priority)/m);
            summary = cutoff > 0 ? md.slice(0, cutoff).trim() : md.slice(0, 1500).trim();
          } catch { /* output file may be gone */ }
        }

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
          summary,
        } as ReviewerRoundSummary;
      } catch { /* skip malformed artifact */ return null; }
    }),
  )).filter((x): x is ReviewerRoundSummary => x !== null) as ReviewerRoundSummary[];

  if (history.length === 0) return undefined;

  const latest = history[history.length - 1]!;
  return {
    roundCount: history.length,
    latestRound: latest.round,
    latestStatus: latest.status,
    latestReviewResult: latest.reviewResult,
    history,
  };
}

/**
 * Find the most-recent `.pan/review/review-<ISSUEID>-<TIMESTAMP>/` directory
 * for an issue. Returns the absolute path or null if none exist.
 *
 * Used to disambiguate between "round just completed (output file present)" and
 * "new round in progress (output file not yet written)" when the canonical
 * reviewer tmux session is alive across rounds (PAN-915).
 */
async function findLatestReviewRunDir(
  workspacePath: string,
  issueId: string,
): Promise<string | null> {
  try {
    const reviewRoot = join(workspacePath, '.pan', 'review');
    const entries = await readdir(reviewRoot);
    const upper = issueId.toUpperCase();
    const lower = issueId.toLowerCase();
    let bestDir: string | null = null;
    let bestTs = -Infinity;
    for (const entry of entries) {
      // Pattern: review-<ISSUEID>-<unixMillis>
      // Tolerant of either case in the prefix segment
      const upperPrefix = `review-${upper}-`;
      const lowerPrefix = `review-${lower}-`;
      const trailing = entry.startsWith(upperPrefix)
        ? entry.slice(upperPrefix.length)
        : entry.startsWith(lowerPrefix)
          ? entry.slice(lowerPrefix.length)
          : null;
      if (trailing === null) continue;
      const ts = Number(trailing);
      if (!Number.isFinite(ts)) continue;
      if (ts > bestTs) {
        bestTs = ts;
        bestDir = join(reviewRoot, entry);
      }
    }
    return bestDir;
  } catch {
    return null;
  }
}

export async function readSynthesisRounds(
  issueId: string,
  projectKey: string,
  agentsRoot: string = join(homedir(), '.panopticon', 'agents'),
): Promise<ReviewerRoundMetadata | undefined> {
  return readReviewerRounds(getReviewerSessionName('synthesis', projectKey, issueId), agentsRoot);
}

/**
 * Build exactly four canonical convoy reviewer nodes for an issue. Synthesis
 * metadata is attached to the parent review node by callers via readSynthesisRounds.
 */
export async function buildReviewerNodes(
  opts: BuildReviewerNodesOptions,
): Promise<ReviewerNode[]> {
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');

  // PAN-915 — current-round output dir disambiguates "zombie session from prior
  // round" vs "alive session for the round currently in progress". When the
  // canonical session is reused (sendKeys delivers a new prompt to the same
  // tmux pane), `readReviewerRounds` still reports the previous round's
  // archived status because the new round hasn't archived yet. Without this
  // check, an in-progress round looks like a completed-zombie and renders as
  // stopped in the dashboard.
  const latestReviewRunDir = await findLatestReviewRunDir(opts.workspacePath, opts.issueId);

  const nodes = await Promise.all(
    CONVOY_REVIEWER_ROLES.map(async (role) => {
      const sessionId = getReviewerSessionName(role, opts.projectKey, opts.issueId);
      const isLive = opts.tmuxSessionNames.has(sessionId);
      const roundMetadata = await readReviewerRounds(sessionId, agentsRoot);
      // Reviewers run inside the workspace (pan review run sets cwd to workspace),
      // so JSONL files land in the workspace-encoded Claude projects dir.
      // Fall back to projectPath only if workspacePath is unavailable.
      const jsonlCwd = opts.workspacePath ?? opts.projectPath;
      const jsonlPath = await resolveJsonlPath(sessionId, jsonlCwd, {
        agentsDirOverride: opts.agentsDirOverride,
      });

      // PAN-915 — definitive "this round is in progress" signal: the latest
      // review-run dir exists but this role's output file hasn't landed yet.
      const latestRunOutputExists = latestReviewRunDir
        ? existsSync(join(latestReviewRunDir, `${role}.md`))
        : false;
      const inProgressThisRound = isLive && latestReviewRunDir !== null && !latestRunOutputExists;

      // Determine if the reviewer is genuinely working or just a zombie session.
      // A reviewer is a zombie when: tmux is alive, the latest archived round
      // artifact says completed/failed, AND no newer round directory has
      // appeared in the workspace (i.e. the coordinator was supposed to kill
      // the pane but didn't). Treating zombies as "running" causes spinner
      // loops and terminal reconnects.
      const latestRoundDone = roundMetadata?.latestStatus === 'completed'
        || roundMetadata?.latestStatus === 'failed';
      const isZombie = isLive && latestRoundDone && !inProgressThisRound;

      // Detect API errors in live sessions (e.g. 502 unknown provider, retry exhaustion)
      const hasApiError = (isLive && !isZombie) ? await detectApiError(sessionId) : false;

      // Per-reviewer endedAt: the agent's own stoppedAt from state.json, falling
      // back to the latest round's endedAt artifact, and finally the parent's
      // endedAt. The parent is a poor fallback because the synthesizer typically
      // outlives the convoy children — using it leaves stopped children with
      // endedAt=undefined while the parent is still active.
      const ownStoppedAt = (!isLive || isZombie)
        ? await readReviewerStoppedAt(sessionId, agentsRoot)
        : undefined;
      const latestRoundEndedAt = roundMetadata?.history.at(-1)?.endedAt
        ?? roundMetadata?.history.at(-1)?.archivedAt;
      const nodeEndedAt = (isLive && !isZombie)
        ? opts.endedAt
        : (ownStoppedAt ?? latestRoundEndedAt ?? opts.endedAt);

      let presence: SessionNodePresence;
      if (hasApiError) {
        presence = 'idle';
      } else if (isLive && !isZombie) {
        presence = (opts.status === 'running' || inProgressThisRound) ? 'active' : 'idle';
      } else {
        // Zombie or dead — treat as ended so terminal won't try to connect
        presence = isZombie ? 'idle' : 'ended';
      }

      // Per-role status:
      //   - live AND has API error → error
      //   - live AND running this round → running
      //   - live AND not zombie (parent says running) → running
      //   - zombie → use the archived round status (completed/failed)
      //   - dead with round metadata → use archived round status
      //   - dead without round metadata but has JSONL → completed (ran but no round artifact)
      //   - dead without round metadata or JSONL → parent status fallback
      const rawStatus = hasApiError
        ? 'error'
        : (isLive && !isZombie)
          ? 'running'
          : (roundMetadata?.latestStatus ?? (jsonlPath ? 'completed' : opts.status));
      const status = normalizeAgentStatus(rawStatus);

      const node: ReviewerNode = {
        type: 'reviewer',
        role,
        sessionId,
        // Expose tmux session name only when genuinely active (not zombie)
        tmuxSession: (isLive && !isZombie) ? sessionId : undefined,
        model: 'specialist',
        startedAt: opts.startedAt,
        endedAt: nodeEndedAt,
        duration: opts.startedAt && nodeEndedAt
          ? (() => {
              const ms = new Date(nodeEndedAt).getTime() - new Date(opts.startedAt).getTime();
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
