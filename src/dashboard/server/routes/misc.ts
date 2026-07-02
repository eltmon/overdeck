/**
 * Misc route module — Effect HttpRouter.Layer (PAN-428 B17)
 *
 * Catch-all for API routes not covered by B6-B16. Implements:
 *
 *   POST /api/trackers/refresh
 *   GET  /api/project-mappings
 *   PUT  /api/project-mappings
 *   POST /api/project-mappings
 *   GET  /api/system/health
 *   GET  /api/godview/system-health
 *   GET  /api/health/agents
 *   POST /api/health/agents/:id/ping
 *   GET  /api/tracker-status
 *   POST /api/rally/validate
 *   GET  /api/no-resume-mode
 *   GET  /api/deacon/status
 *   GET  /api/deacon/logs
 *   POST /api/deacon/patrol
 *   GET  /api/version
 *   GET  /api/registered-projects
 *   GET  /api/confirmations
 *   POST /api/confirmations/:id/respond
 *   GET  /api/skills
 *   GET  /api/planning/:issueId/status
 *   POST /api/planning/:issueId/message
 *   DELETE /api/planning/:issueId
 *   GET  /api/services/tldr/status
 *   POST /api/services/tldr/start
 *   POST /api/services/tldr/stop
 *   GET  /api/cache-status
 *   GET  /api/metrics/runtimes
 *   GET  /api/metrics/tasks
 *   POST /api/shadow/:issueId/monitor
 *   POST /api/shadow/:issueId/observe
 *   POST /api/dev/rebuild
 *   POST /api/system/restart-dashboard
 */

import { Layer } from 'effect';

import { bootReconciliationRouteLayer } from './boot-reconciliation.js';
import { projectMappingsRouteLayer } from './misc/project-mappings.js';
import { trackersRouteLayer } from './misc/trackers.js';
import { healthRouteLayer } from './misc/health.js';
import { deaconRouteLayer } from './misc/deacon.js';
import { planningRouteLayer } from './misc/planning.js';
import { tldrRouteLayer } from './misc/tldr.js';
import { metaRouteLayer } from './misc/meta.js';

export { readPackageVersion } from './misc/shared.js';

export const miscRouteLayer = Layer.mergeAll(
  trackersRouteLayer,
  projectMappingsRouteLayer,
  healthRouteLayer,
  deaconRouteLayer,
  bootReconciliationRouteLayer,
  planningRouteLayer,
  tldrRouteLayer,
  metaRouteLayer,
);

export default miscRouteLayer;
