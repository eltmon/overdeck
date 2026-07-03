/**
 * Specialists route module — Effect HttpRouter.Layer (PAN-428 B9)
 *
 * Implements all /api/specialists/* endpoints from the Express server:
 *   GET    /api/specialists
 *   POST   /api/specialists/reset-all
 *   POST   /api/specialists/done
 *   POST   /api/specialists/logs/cleanup-all
 *   GET    /api/specialists/queues
 *   GET    /api/specialists/projects
 *   POST   /api/specialists/:name/wake
 *   POST   /api/specialists/:name/reset
 *   POST   /api/specialists/:name/init
 *   POST   /api/specialists/:name/report-status
 *   GET    /api/specialists/:name/cost
 *   GET    /api/specialists/:name/queue
 *   POST   /api/specialists/:name/queue
 *   DELETE /api/specialists/:name/queue/:itemId
 *   PUT    /api/specialists/:name/queue/reorder
 *   POST   /api/specialists/:name/auto-complete
 *   GET    /api/specialists/:project/:issueId/:type/status
 *   POST   /api/specialists/:project/:issueId/:type/kill
 *   GET    /api/specialists/:project/:type/queue
 *   POST   /api/specialists/:project/:type/spawn
 *   GET    /api/specialists/:project/:type/runs
 *   GET    /api/specialists/:project/:type/runs/:runId
 *   GET    /api/specialists/:project/:type/runs/:runId/stream
 *   POST   /api/specialists/:project/:type/runs/:runId/terminate
 *   POST   /api/specialists/:project/:type/grace/pause
 *   POST   /api/specialists/:project/:type/grace/resume
 *   POST   /api/specialists/:project/:type/grace/exit
 *   GET    /api/specialists/:project/:type/grace
 *   GET    /api/specialists/:project/:type/context
 *   POST   /api/specialists/:project/:type/context/regenerate
 *   POST   /api/specialists/:project/:type/complete
 *   GET    /api/specialists/:project/:type/latest-log
 *   POST   /api/specialists/:project/:type/logs/cleanup
 */

import { Layer } from 'effect';

import { specialistsLegacyRouteLayer } from './specialists/legacy-routes.js';
import { specialistsProjectRouteLayer } from './specialists/project-routes.js';

export {
  _serverManagedMerges,
  firePostMergeLifecycle,
  validateSpecialistAutoCompleteMetadata,
} from './specialists/shared.js';

export const specialistsRouteLayer = Layer.mergeAll(
  specialistsLegacyRouteLayer,
  specialistsProjectRouteLayer,
);

export default specialistsRouteLayer;
