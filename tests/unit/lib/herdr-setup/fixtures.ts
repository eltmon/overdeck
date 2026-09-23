/**
 * Recorded host evidence (PAN-3956 PRD §7), captured read-only from this host
 * with herdr 0.9.1. Used as fixtures by the herdr-setup tests.
 */

/** `herdr --session overdeck status --json` with the session server running. */
export const STATUS_RUNNING_JSON = '{"client":{"version":"0.9.1","channel":"stable","protocol":22,"endpoint_protocol_generation":1,"endpoint_capabilities":["surface_interest","presentation_effects_fence","health_check"],"remote_host_bridge":true,"remote_bridge_idle_timeout":true,"binary":"/home/eltmon/.local/bin/herdr","session":"overdeck"},"server":{"status":"running","running":true,"version":"0.9.1","protocol":22,"capabilities":{"live_handoff":true,"detached_server_daemon":true,"endpoint_protocol_generation":1,"surface_interest":true,"health_check":true},"compatible":true,"endpoint_compatible":true,"socket":"/home/eltmon/.config/herdr/sessions/overdeck/herdr.sock","session":"overdeck","restart_needed":false,"server_binary_stale":false},"update":{"restart_needed":false,"server_binary_stale":false}}';

/** `herdr --session <unused> status --json` for a session with no server (exit 0). */
export const STATUS_NOT_RUNNING_JSON = '{"client":{"version":"0.9.1","channel":"stable","protocol":22,"endpoint_protocol_generation":1,"endpoint_capabilities":["surface_interest","presentation_effects_fence","health_check"],"remote_host_bridge":true,"remote_bridge_idle_timeout":true,"binary":"/home/eltmon/.local/bin/herdr","session":"pan3956-probe-nonexistent"},"server":{"status":"not_running","running":false,"version":null,"protocol":null,"capabilities":null,"compatible":null,"endpoint_compatible":null,"socket":"/home/eltmon/.config/herdr/sessions/pan3956-probe-nonexistent/herdr.sock","session":"pan3956-probe-nonexistent","restart_needed":false,"server_binary_stale":false},"update":{"restart_needed":false,"server_binary_stale":false}}';

/** `herdr integration status` (the targets Overdeck reports on, plus the experimental shape). */
export const INTEGRATION_STATUS_TEXT = [
  'pi: not installed (/home/eltmon/.pi/agent/extensions/herdr-agent-state.ts)',
  'omp: not installed (/home/eltmon/.omp/agent/extensions/herdr-omp-agent-state.ts)',
  'claude: not installed (/home/eltmon/.claude/hooks/herdr-agent-state.sh)',
  'codex: not installed (/home/eltmon/.codex/herdr-agent-state.sh)',
  'kimi: not installed (/home/eltmon/.kimi-code/hooks/herdr-agent-state.sh)',
  'opencode: not installed (/home/eltmon/.config/opencode/plugins/herdr-agent-state.js)',
  'hermes: not installed (/home/eltmon/.hermes/plugins/herdr-agent-state/__init__.py)',
  'letta (experimental): not installed (/home/eltmon/.letta/hooks/herdr-agent-session.sh)',
  '',
].join('\n');

/** The same targets after install. The `installed (` wording is inferred (see W8 checkpoint). */
export function integrationStatusAllInstalled(): string {
  return INTEGRATION_STATUS_TEXT.replaceAll(': not installed (', ': installed (');
}

/** The hand-written unit on this host before PAN-3956. */
export const HAND_WRITTEN_UNIT = [
  '[Unit]',
  'Description=Herdr headless server for Overdeck (session: overdeck)',
  '',
  '[Service]',
  'ExecStart=%h/.local/bin/herdr --session overdeck server',
  'Restart=on-failure',
  'RestartSec=3',
  '',
  '[Install]',
  'WantedBy=default.target',
  '',
].join('\n');

/** `herdr --default-config` lines 327–330. */
export const DEFAULT_CONFIG_SESSION_SECTION = [
  '[session]',
  '# Resume supported AI-agent panes into their native conversation sessions after',
  '# a Herdr server restart. Requires official integrations that report session refs.',
  '# resume_agents_on_restore = true',
].join('\n');
