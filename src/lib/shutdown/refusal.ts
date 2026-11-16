/**
 * HTTP refusal for the conversation doors while a shutdown drains (PAN-5342, D-2).
 * Create, resume and message answer a clean 409 before they reach the launch.
 */
import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { SHUTDOWN_REFUSAL, isShutdownDrainingSync } from './drain-record.js';

export function shutdownDrainingRefusal(): ReturnType<typeof jsonResponse> | null {
  return isShutdownDrainingSync()
    ? jsonResponse({ error: SHUTDOWN_REFUSAL, code: 'shutdown-draining' }, { status: 409 })
    : null;
}
