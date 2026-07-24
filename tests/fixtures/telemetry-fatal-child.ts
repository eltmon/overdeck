import { AnalyticsService } from '../../src/lib/telemetry/service.js';

const mode = process.argv[2];
if (mode !== 'uncaughtException' && mode !== 'unhandledRejection') {
  throw new Error(`Unknown fatal telemetry mode: ${mode}`);
}

const analytics = new AnalyticsService('server', {
  captureProcessExceptions: true,
});
analytics.capture('server_boot', {
  project_count: '0',
  active_agent_count: '0',
});

const privateError = new Error(
  'PAN-2599 failed in /home/alice/private-repo with token ghp_secret',
);
if (mode === 'unhandledRejection') {
  void Promise.reject(privateError);
} else {
  setImmediate(() => { throw privateError; });
}
