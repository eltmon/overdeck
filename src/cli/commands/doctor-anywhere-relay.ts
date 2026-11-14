// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-fly.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import { callDashboard } from './dashboard-call.js';

const STATUS_TIMEOUT_MS = 3_000;
const RELAY_CHECK_TIMEOUT_MS = 25_000;
const ROW = 'TURN relay';

/** `turns:turn.example:443?transport=tcp` -> `turn.example:443`; no port means the scheme's default. */
function turnHostPort(turnUrl: string): string {
  const withoutQuery = turnUrl.split('?', 1)[0]!;
  const isTurns = withoutQuery.startsWith('turns:');
  const authority = withoutQuery.slice(withoutQuery.indexOf(':') + 1);
  return authority.includes(':') ? authority : `${authority}:${isTurns ? 5349 : 3478}`;
}

type RelayCheckResponse =
  | { state: 'skipped' }
  | { state: 'refused'; detail: string }
  | { state: 'unanswered'; detail: string }
  | { state: 'ok'; relayCandidates: number; turnUrl: string; elapsedMs: number }
  | { state: 'failed'; turnUrl: string | null; detail: string };

/**
 * `pan doctor`'s `TURN relay` row (PAN-5242): silent unless this machine is signed in with the
 * relay plan, since the check is a live gather and costs attention for nothing otherwise.
 */
export async function checkAnywhereRelay(options: { call?: typeof callDashboard } = {}): Promise<CheckResult[]> {
  const call = options.call ?? callDashboard;

  const statusController = new AbortController();
  const statusTimer = setTimeout(() => statusController.abort(), STATUS_TIMEOUT_MS);
  let status: { directory?: { state: string } | null; relay?: unknown } | null;
  try {
    const response = await call('/api/anywhere/status', { method: 'GET', signal: statusController.signal });
    if (response.status !== 200) return [];
    status = (await response.json()) as typeof status;
  } catch {
    return [];
  } finally {
    clearTimeout(statusTimer);
  }
  if (status?.directory?.state !== 'online' || status.relay === null || status.relay === undefined) return [];

  const relayController = new AbortController();
  const relayTimer = setTimeout(() => relayController.abort(), RELAY_CHECK_TIMEOUT_MS);
  let response: Response;
  try {
    response = await call('/api/anywhere/relay-check', { method: 'POST', signal: relayController.signal });
  } catch (error) {
    clearTimeout(relayTimer);
    if (relayController.signal.aborted) return [{ name: ROW, status: 'warn', message: 'The relay check did not answer within 25 s' }];
    const message = error instanceof Error ? error.message : String(error);
    return [{ name: ROW, status: 'warn', message: `The relay check failed: ${message}` }];
  }
  clearTimeout(relayTimer);
  if (response.status !== 200) return [{ name: ROW, status: 'warn', message: `The relay check answered HTTP ${response.status}` }];

  const check = (await response.json()) as RelayCheckResponse;
  switch (check.state) {
    case 'skipped':
      return [];
    case 'ok':
      return [{ name: ROW, status: 'ok', message: `Gathered ${check.relayCandidates} relay candidate(s) via ${check.turnUrl} in ${check.elapsedMs} ms` }];
    case 'refused':
      return [{ name: ROW, status: 'warn', message: `overdeck.ai refused relay credentials: ${check.detail}` }];
    case 'unanswered':
      return [{ name: ROW, status: 'warn', message: `overdeck.ai did not send relay credentials: ${check.detail}` }];
    case 'failed':
      if (check.turnUrl === null) {
        return [{
          name: ROW,
          status: 'warn',
          message: `overdeck.ai sent relay credentials with no TURN server: ${check.detail}`,
          fix: "This is an overdeck.ai service problem, not this machine's network. Report it.",
        }];
      }
      return [{
        name: ROW,
        status: 'warn',
        message: `This machine gathered no TURN relay candidate: ${check.detail}`,
        fix: `Allow outbound TLS to ${turnHostPort(check.turnUrl)} (or UDP 3478) from this machine. Until then phones and bots cannot reach it through the relay.`,
      }];
  }
}
