/**
 * Cutover — seeds overdeck.db from panopticon.db + open-issue state.
 *
 * Prerequisite: the caller must create overdeck.db (schema applied) before
 * calling makeCutoverEffect. Use `createOverdeckDatabase` from
 * scripts/create-overdeck-db.ts for that step.
 *
 * What this module does:
 *   1. Export conversation metadata from panopticon.db (read-only on legacy).
 *   2. Reconstruct in-flight pipeline/agent state from open issue IDs + tmux sessions.
 *
 * panopticon.db is never written to — it stays intact as the rollback backup.
 *
 * Requires Projects, Records, and Tmux from the caller — pass the live or
 * fake implementations depending on the execution context (production vs. test).
 */
import { Effect, Layer } from 'effect';

import { makeDbLive, type Projects, type Records, type Tmux } from './infra.js';
import {
  Reconstruction,
  ReconstructionLive,
  type RebuildSources,
} from './reconstruction.js';
import { exportLegacyConversations } from './conversations-export.js';
import { getOverdeckDatabasePath } from './paths.js';

export interface CutoverOptions {
  /** Path to the legacy panopticon.db — opened read-only (SELECT only) during export. */
  readonly legacyDbPath: string;
  /**
   * Path to the already-initialised overdeck.db. Defaults to getOverdeckDatabasePath().
   * The schema must already be applied (call createOverdeckDatabase first).
   */
  readonly overdeckDbPath?: string;
  /** Open GitHub issue IDs, used to seed the issues + agents tables via Reconstruction. */
  readonly sources: RebuildSources;
}

export interface CutoverResult {
  readonly overdeckDbPath: string;
  readonly conversationsExported: number;
  readonly conversationFilesExported: number;
  readonly favoritesExported: number;
  readonly issuesUpserted: number;
  readonly agentsUpserted: number;
}

/**
 * Seed overdeck.db with data from panopticon.db and open GitHub issues.
 *
 * Requirements (provided by the caller):
 *   - Projects — resolves issue IDs to project configs.
 *   - Records  — reads .pan/records/*.json from git.
 *   - Tmux     — lists live agent tmux sessions.
 */
export const makeCutoverEffect = (
  opts: CutoverOptions,
): Effect.Effect<CutoverResult, unknown, Projects | Records | Tmux> =>
  Effect.gen(function* () {
    const overdeckDbPath = opts.overdeckDbPath ?? getOverdeckDatabasePath();

    // Step 1: Export conversations from panopticon.db.
    // openDatabase() inside exportLegacyConversations only calls .prepare().all()
    // on the legacy handle — no INSERT/UPDATE/DELETE touches panopticon.db.
    const exportResult = exportLegacyConversations(opts.legacyDbPath, overdeckDbPath);

    // Step 2: Reconstruct in-flight pipeline/agent state.
    // Db is wired internally to overdeckDbPath via Effect.scoped so the connection
    // is properly released when reconstruction completes.
    // Projects/Records/Tmux are threaded through from the caller's context.
    const dbLayer = makeDbLive(overdeckDbPath);
    const reconResult = yield* Effect.scoped(
      Reconstruction.use((r) => r.rebuild(opts.sources)).pipe(
        Effect.provide(ReconstructionLive.pipe(Layer.provide(dbLayer))),
      ),
    );

    return {
      overdeckDbPath,
      conversationsExported: exportResult.conversations,
      conversationFilesExported: exportResult.conversationFiles,
      favoritesExported: exportResult.favorites,
      issuesUpserted: reconResult.issuesUpserted,
      agentsUpserted: reconResult.agentsUpserted,
    };
  });
