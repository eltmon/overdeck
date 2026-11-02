/**
 * Conversation housekeeping sweeps of the primary dashboard. Each writes
 * overdeck.db, so main.ts starts this only when it is not a peer dashboard.
 * PAN-3822 PR sync, PAN-4640 schedules.
 */
import { startPullRequestSyncService, stopPullRequestSyncService } from './pull-request-sync-service.js';
import { startConversationScheduleService, stopConversationScheduleService } from './conversation-schedule-service.js';

export function startConversationSweeps(): void {
  startPullRequestSyncService();
  console.log('[pr-sync] started (boot +30s, 60s sweep)');
  startConversationScheduleService();
  console.log('[schedules] started (boot +30s, 60s sweep)');
}

export function stopConversationSweeps(): void {
  stopPullRequestSyncService();
  stopConversationScheduleService();
}
