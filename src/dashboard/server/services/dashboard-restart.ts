import { spawn } from 'node:child_process';

import { panCliInvocation } from '../../../lib/pan-cli-invocation.js';
import { RESTART_GATE_CLAIMED_ENV } from '../../../lib/restart-gate-client.js';
import { getRestartGate } from './restart-gate.js';

// Fire-and-forget restart of the dashboard server. Spawns a detached
// `pan restart --dashboard` so the new process outlives the SIGTERM that kills
// this server. Used by POST /api/system/restart-dashboard (the browser fallback
// path in App.tsx when window.overdeckBridge is not available) and by the fleet
// update job after it installs a new Overdeck (PAN-4654 D-9).
//
// PAN-3729: the caller's request IS operator approval.
// Two things follow from that:
//   1. Every request waiting in the restart gate is folded into an epoch this
//      restart claims, so the next boot marks them satisfied and the blocked
//      requesters exit instead of waiting for an approval that already happened.
//   2. The spawned CLI carries OVERDECK_RESTART_GATE_CLAIMED=1: it performs the
//      restart as the claimant of the epoch created in (1) instead of
//      re-negotiating the gate (which would register a request the new server
//      has to expire). Same pattern as the deploy script's `pan restart` child.
export async function restartDashboardDetached(
  requester: string,
): Promise<{ ok: true; pid: number | null } | { ok: false; error: string }> {
  try {
    await getRestartGate().satisfyForDirectRestart(requester);
  } catch (error: unknown) {
    // The gate is runtime-plane convenience state — never let it block the
    // restart the operator explicitly asked for.
    console.error('[restart-dashboard] restart-gate implicit approval failed:', error);
  }
  try {
    const invocation = panCliInvocation(['restart', '--dashboard']);
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [RESTART_GATE_CLAIMED_ENV]: '1' },
    });
    child.on('error', (err) => {
      console.error('[restart-dashboard] pan restart spawn failed:', err);
    });
    child.unref();
    return { ok: true, pid: child.pid ?? null };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
