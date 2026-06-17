import { join } from 'node:path';

import { Context, Effect, Layer } from 'effect';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { Db, Projects, Records, Tmux } from './infra.js';
import { overdeckIssues, type IssueId, type Stage } from './issues.js';
import type { AgentId } from './agents.js';
import { derivePipelinePhase } from '../reconstruct/derive-phase.js';
import type { PanIssueRecord } from '../pan-dir/record.js';

// ── Local agents table (mirrors agents.ts — not exported there) ────────────

const agentsTable = sqliteTable('agents', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  workspace: text('workspace').notNull(),
  harness: text('harness').notNull(),
  model: text('model').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ── Public types ──────────────────────────────────────────────────────────

/** Sources the caller provides; GitHub open-issue list is the primary external input. */
export interface RebuildSources {
  /** Issue IDs confirmed open on GitHub (caller's responsibility to fetch). */
  readonly openIssueIds: ReadonlySet<string>;
}

export interface ReconstructResult {
  readonly issuesUpserted: number;
  readonly agentsUpserted: number;
}

export interface ReconstructionServiceShape {
  readonly rebuild: (sources: RebuildSources) => Effect.Effect<ReconstructResult>;
}

export class Reconstruction extends Context.Service<Reconstruction, ReconstructionServiceShape>()(
  'overdeck/Reconstruction',
) {}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Parse an issue ID from a work-agent session name.
 * `agent-pan-1938` → `PAN-1938`, `agent-min-123` → `MIN-123`.
 * Returns null for convoy review lanes (e.g. `agent-pan-1938-review-correctness`).
 */
function parseIssueIdFromSession(sessionName: string): string | null {
  const m = /^agent-([a-z]+)-(\d+)$/.exec(sessionName);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}`;
}

function deriveStage(record: PanIssueRecord | null): Stage {
  if (!record) return 'working';
  if (record.pipeline.mergeStatus === 'merged') return 'verifying_on_main';
  const phase = derivePipelinePhase({
    issueClosed: false,
    hasPr: !!record.pipeline.prUrl,
    record,
    reviewDecision: null,
  });
  switch (phase) {
    case 'work':   return 'working';
    case 'review': return 'in_review';
    case 'merge':  return 'merging';
    case 'done':   return 'closed';
  }
}

// ── Live Layer ────────────────────────────────────────────────────────────

export const ReconstructionLive = Layer.effect(
  Reconstruction,
  Effect.gen(function* () {
    const db       = yield* Db;
    const projects = yield* Projects;
    const records  = yield* Records;
    const tmux     = yield* Tmux;

    return Reconstruction.of({
      rebuild: (sources) =>
        Effect.gen(function* () {
          // Build a map of issueId → sessionName for live work-agent sessions.
          const liveSessions = yield* tmux.listSessions();
          const sessionByIssueId = new Map<string, string>();
          for (const name of liveSessions) {
            const issueId = parseIssueIdFromSession(name);
            if (issueId && sources.openIssueIds.has(issueId)) {
              sessionByIssueId.set(issueId, name);
            }
          }

          let issuesUpserted = 0;
          let agentsUpserted = 0;
          const now = new Date();

          for (const issueId of sources.openIssueIds) {
            // Resolve the project config so we know where the record lives.
            const project = yield* projects.resolveIssue(issueId);
            if (!project) continue;

            // Read the git-tracked record (.pan/records/<issue-lc>.json).
            const record = yield* records.readIssue(project, issueId);

            const stage  = deriveStage(record);
            const prPipe = record?.pipeline;

            // Upsert the issue row — idempotent via onConflictDoUpdate.
            yield* Effect.promise(async () => {
              await db.q
                .insert(overdeckIssues)
                .values({
                  id:                   issueId as IssueId,
                  stage,
                  reviewOutcome:        null,
                  testOutcome:          null,
                  verificationOutcome:  null,
                  verdictCommit:        null,
                  blockers:             [],
                  planRef:              null,
                  prUrl:                prPipe?.prUrl    ?? null,
                  prNumber:             prPipe?.prNumber ?? null,
                  prHeadSha:            prPipe?.prHeadSha ?? null,
                  updatedAt:            now,
                })
                .onConflictDoUpdate({
                  target: overdeckIssues.id,
                  set: {
                    stage,
                    prUrl:    prPipe?.prUrl    ?? null,
                    prNumber: prPipe?.prNumber ?? null,
                    prHeadSha: prPipe?.prHeadSha ?? null,
                    updatedAt: now,
                  },
                });
            });
            issuesUpserted++;

            // Upsert the agent row if a live work-agent session exists and the
            // record has harness/model (the durable agent identity source, PAN-1919).
            const sessionName = sessionByIssueId.get(issueId);
            if (sessionName && record?.harness && record?.model) {
              const workspace = join(project.path, 'workspaces', `feature-${issueId.toLowerCase()}`);
              yield* Effect.promise(async () => {
                await db.q
                  .insert(agentsTable)
                  .values({
                    id:        sessionName as AgentId,
                    issueId,
                    role:      'work',
                    status:    'running',
                    workspace,
                    harness:   record.harness as string,
                    model:     record.model   as string,
                    updatedAt: now,
                  })
                  .onConflictDoUpdate({
                    target: agentsTable.id,
                    set: {
                      status:    'running',
                      workspace,
                      harness:   record.harness as string,
                      model:     record.model   as string,
                      updatedAt: now,
                    },
                  });
              });
              agentsUpserted++;
            }
          }

          return { issuesUpserted, agentsUpserted };
        }),
    });
  }),
);
