/**
 * Registered workers (PAN-3920 Phase B): `pan worker run | wait | report | list`.
 *
 * A worker is a native agent with role `worker` that one agent or conversation
 * (its parent) spawns for a bounded brief. It runs in a persistent pane, stays
 * warm after it reports, and hands its result back as numbered report files.
 */
export {
  WORKER_ID_RE,
  agentsRoot,
  allocateWorkerId,
  isWorkerId,
  reportsDir,
  workerDir,
  workerFactsPath,
  workerNumber,
} from './ids.js';
export {
  MAX_WORKER_REPORT_BYTES,
  WORKER_REPORT_STATUSES,
  isWorkerReportStatus,
  latestWorkerReport,
  latestWorkerReportAt,
  listWorkerReports,
  writeWorkerReport,
  type WorkerReport,
  type WorkerReportStatus,
} from './report.js';
export {
  PARENT_ID_RE,
  readWorkerFacts,
  reportFooter,
  startWorker,
  type StartWorkerDeps,
  type StartWorkerOptions,
  type StartedWorker,
  type WorkerFacts,
} from './start.js';
export {
  WAIT_IDLE_GRACE_MS,
  WAIT_POLL_MS,
  WAIT_STARTUP_GRACE_MS,
  fetchLastAssistantMessageFromDashboard,
  waitForWorkerReport,
  type WaitDeps,
  type WaitOptions,
  type WaitOutcome,
} from './wait.js';
export { listWorkers, type WorkerListing } from './list.js';
