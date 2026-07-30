/**
 * Memory backfill from historical Claude Code JSONL transcripts (PAN-1990 FR-12).
 *
 * Enumerates `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, maps each session's first-message
 * cwd to a registered workspace, and feeds the whole transcript through the
 * existing extraction pipeline (extractFromTranscriptDelta) with the resolved
 * MemoryIdentity. Sessions whose cwd matches no workspace are skipped.
 *
 * HAZARD H5: strictly read-only on JSONL. Every read here goes through
 * discoverJsonlFiles (directory listing only) and parseSessionJsonl (a
 * read-only stream) — this module never opens a `~/.claude/projects` file for
 * write, append, or truncate. Claude session files are sacred (see repo
 * CLAUDE.md); the pipeline's own writes land only in Overdeck's memory store.
 *
 * Dedup is NOT reimplemented here — extractFromTranscriptDelta's checkpoint
 * claim (checkpoint-client.ts) already rejects a second claim at the same
 * fromOffset once the first run has committed past it, so a re-run of
 * backfill naturally produces zero new observations for already-processed
 * sessions.
 */
import { stat } from 'node:fs/promises';
import { Effect } from 'effect';
import type { MemoryIdentity } from '@overdeck/contracts';
import { discoverJsonlFiles, type DiscoveredFile } from '../conversations/harness-discovery.js';
import { parseSessionJsonl } from '../conversations/jsonl-async.js';
import { resolveWorkspaceForCwd } from '../workspaces/resolver.js';
import { extractFromTranscriptDelta, type ExtractFromTranscriptDeltaResult, type ExtractFromTranscriptDeltaInput } from './pipeline.js';

export interface BackfillOptions {
  /** Filter to sessions whose resolved workspace belongs to this project id. */
  projectId?: string;
  /** Filter to sessions whose resolved workspace is exactly this workspace id. */
  workspaceId?: string;
  /** Report matches without claiming/extracting/writing anything. */
  dryRun?: boolean;
  now?: Date;
  /** DI seam for tests — defaults to the real claude-projects directory scan. */
  discoverJsonlFiles?: (warnings: string[]) => Promise<DiscoveredFile[]>;
  /** DI seam for tests — defaults to the real read-only JSONL metadata parse. */
  parseSessionJsonl?: (path: string) => Effect.Effect<{ sessionId: string | null; cwdFromFirstMessage: string | null }, never>;
  /** DI seam for tests — defaults to the real workspace resolver. */
  resolveWorkspaceForCwd?: (cwd: string) => ReturnType<typeof resolveWorkspaceForCwd>;
  /** DI seam for tests — overrides only the LLM-calling extract stage, leaving real claim/commit/write intact. */
  extract?: ExtractFromTranscriptDeltaInput['extract'];
  /** DI seam for tests — event-store emission has its own background timers; tests stub this like tests/lib/memory/e2e.test.ts does. */
  emitObservationCreated?: ExtractFromTranscriptDeltaInput['emitObservationCreated'];
  /** DI seam for tests — same rationale as emitObservationCreated. */
  updateHealth?: ExtractFromTranscriptDeltaInput['updateHealth'];
  /** DI seam for tests — full override of the extraction pipeline entrypoint. */
  extractFromTranscriptDelta?: typeof extractFromTranscriptDelta;
}

export type BackfillSessionStatus =
  | 'processed'
  | 'dry-run-matched'
  | 'skipped-unmatched-cwd'
  | 'skipped-unreadable-session';

export interface BackfillSessionResult {
  transcriptPath: string;
  sessionId: string | null;
  cwd: string | null;
  workspaceId: string | null;
  status: BackfillSessionStatus;
  extraction?: ExtractFromTranscriptDeltaResult;
}

export interface BackfillResult {
  sessions: BackfillSessionResult[];
  warnings: string[];
}

export async function backfillMemoryFromTranscripts(options: BackfillOptions = {}): Promise<BackfillResult> {
  const discover = options.discoverJsonlFiles ?? ((warnings: string[]) => discoverJsonlFiles(warnings));
  const parse = options.parseSessionJsonl ?? parseSessionJsonl;
  const resolveWorkspace = options.resolveWorkspaceForCwd ?? resolveWorkspaceForCwd;
  const extract = options.extractFromTranscriptDelta ?? extractFromTranscriptDelta;

  const warnings: string[] = [];
  const files = (await discover(warnings)).filter((file) => file.harness === 'claude-code');

  const sessions: BackfillSessionResult[] = [];
  for (const file of files) {
    const metadata = await Effect.runPromise(parse(file.jsonlPath));
    if (!metadata.sessionId || !metadata.cwdFromFirstMessage) {
      sessions.push({
        transcriptPath: file.jsonlPath,
        sessionId: metadata.sessionId,
        cwd: metadata.cwdFromFirstMessage,
        workspaceId: null,
        status: 'skipped-unreadable-session',
      });
      continue;
    }

    const workspace = resolveWorkspace(metadata.cwdFromFirstMessage);
    if (!workspace) {
      sessions.push({
        transcriptPath: file.jsonlPath,
        sessionId: metadata.sessionId,
        cwd: metadata.cwdFromFirstMessage,
        workspaceId: null,
        status: 'skipped-unmatched-cwd',
      });
      continue;
    }

    if (options.workspaceId && workspace.id !== options.workspaceId) continue;
    if (options.projectId && workspace.projectId !== options.projectId) continue;

    if (options.dryRun) {
      sessions.push({
        transcriptPath: file.jsonlPath,
        sessionId: metadata.sessionId,
        cwd: metadata.cwdFromFirstMessage,
        workspaceId: workspace.id,
        status: 'dry-run-matched',
      });
      continue;
    }

    const { size } = await stat(file.jsonlPath);
    const identity: MemoryIdentity = {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      issueId: workspace.issueId,
      runId: metadata.sessionId,
      sessionId: metadata.sessionId,
      agentRole: 'conversation',
      agentHarness: 'claude-code',
    };

    const extraction = await extract({
      sessionId: metadata.sessionId,
      transcriptPath: file.jsonlPath,
      fromOffset: 0,
      toOffset: size,
      identity,
      trigger: 'manual',
      extract: options.extract,
      emitObservationCreated: options.emitObservationCreated,
      updateHealth: options.updateHealth,
      now: options.now,
    });

    sessions.push({
      transcriptPath: file.jsonlPath,
      sessionId: metadata.sessionId,
      cwd: metadata.cwdFromFirstMessage,
      workspaceId: workspace.id,
      status: 'processed',
      extraction,
    });
  }

  return { sessions, warnings };
}
