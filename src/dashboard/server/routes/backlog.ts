import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { httpHandler } from './http-handler.js';
import { jsonResponse } from '../http-helpers.js';
import { getBacklogSequence } from '../../../lib/database/backlog-sequence-db.js';
import { parseSequenceMd } from '../../../lib/backlog/sequence-io.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Route: GET /api/backlog/sequence ────────────────────────────────────────

const getBacklogSequenceRoute = HttpRouter.add(
  'GET',
  '/api/backlog/sequence',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const projectRoot = process.cwd();
        let rows = getBacklogSequence('overdeck');

        if (rows.length === 0) {
          const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
          if (existsSync(seqPath)) {
            const md = readFileSync(seqPath, 'utf-8');
            const parsed = parseSequenceMd(md);
            if (parsed.ok) {
              rows = parsed.doc.nodes.map((n) => ({
                issueId: n.issue,
                rank: n.rank,
                size: n.size,
                importance: n.importance,
                score: n.score,
                condition: n.condition,
                dependsOn: n.dependsOn,
                why: n.why,
                gate: n.gate,
                planning: n.planning,
                generatedAt: '',
              }));
            }
          }
        }

        const joined = rows.map((row) => {
          const reviewStatus = getReviewStatusSync(row.issueId.toUpperCase());
          const inPipeline =
            reviewStatus !== null && reviewStatus.reviewStatus !== 'pending';
          return {
            ...row,
            inPipeline,
          };
        });

        return jsonResponse({ nodes: joined });
      },
      catch: (err) => new Error(String(err)),
    });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const backlogRouteLayer = Layer.mergeAll(
  getBacklogSequenceRoute,
);

export default backlogRouteLayer;
