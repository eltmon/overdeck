/**
 * Shared IssueDataService singleton — used by both domain-services (snapshot)
 * and issue route handlers (polling). Avoids circular imports.
 */
import { IssueDataService } from './issue-data-service.js';
import { CacheService } from './cache-service.js';

const noopIo = { emit: () => {}, on: () => {} } as any;

let _service: IssueDataService | null = null;
let _startPromise: Promise<void> | null = null;

export function getSharedIssueService(): IssueDataService {
  if (!_service) {
    _service = new IssueDataService(noopIo, new CacheService());
  }
  return _service;
}

export function startSharedIssueService(): Promise<void> {
  if (_startPromise) return _startPromise;
  _startPromise = getSharedIssueService().start().catch((err: unknown) => {
    console.error('[issue-service-singleton] start failed:', err);
  });
  return _startPromise;
}
