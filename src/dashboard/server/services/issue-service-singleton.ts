/**
 * Shared IssueDataService singleton — used by read model (bootstrap),
 * route handlers (force-refresh, diagnostics), and event emission.
 */
import { IssueDataService } from './issue-data-service.js';
import { CacheService } from './cache-service.js';

let _service: IssueDataService | null = null;
let _startPromise: Promise<void> | null = null;

export function getSharedIssueService(): IssueDataService {
  if (!_service) {
    _service = new IssueDataService(new CacheService());
  }
  return _service;
}

export function startSharedIssueService(options?: { skipPolling?: boolean }): Promise<void> {
  if (_startPromise) return _startPromise;
  _startPromise = getSharedIssueService().start(options).catch((err: unknown) => {
    console.error('[issue-service-singleton] start failed:', err);
  });
  return _startPromise;
}
