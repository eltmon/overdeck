import { existsSync } from 'fs';
import { Effect } from 'effect';
import { emitActivityEntry } from '../activity-logger.js';
import { getWorkspaceStackHealth } from '../workspace/stack-health.js';
import { resolveIssueStackDiskHold } from '../workspace/disk-cost.js';
import { getPrFacts } from '../cloister/pr-facts.js';
import type { Role } from './role.js';

/**
 * Spawn-time stack-rebuild self-heal state. PAN-1618: the work-spawn gate
 * (`assertWorkspaceStackHealthyForSpawn`) used to fail hard when the workspace
 * docker stack was down, with only manual recoveries (`pan workspace rebuild`
 * or interactive `--host`). Under autonomous operation a fully-planned
 * `proposed` item whose stack happened to be down could never auto-start its
 * work agent — it sat at the gate forever. This mirrors the PAN-1247
 * orphan-test self-heal one role earlier: rebuild the stack before failing,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const spawnStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean; hostFallbackNoticed?: boolean }> =
  new Map();
const SPAWN_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const SPAWN_STACK_REBUILD_MAX_ATTEMPTS = 3;

/**
 * Spawn a role-based Overdeck run. Work delegates to the existing work-agent
 * path; review/test/ship use the role definition files under roles/.
 */
export async function prepareWorkspaceForAgentSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  // PAN-3917: the stale-closedOut-record clear this used to run
  // (reopen-guard.ts's clearStaleClosedOutBeforeSpawn) read/wrote
  // record.pipeline.closedOut, which no longer exists — status is derived
  // live from git/tracker/PR state, not a stored record, so there is
  // nothing stale to clear before a respawn.
  await assertWorkspaceStackHealthyForSpawn(issueId, role, allowHost, workspacePath);
}

export async function assertWorkspaceStackHealthyForSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  if (role === 'plan' || role === 'knowledge' || role === 'worker') return;

  // PAN-1872: guard against an undefined issueId so workspace health checks do
  // not crash with `Cannot read properties of undefined (reading 'toUpperCase')`
  // while pan start is recovering from a sync-main conflict.
  const normalizedIssue = (issueId ?? '').toUpperCase();

  // PAN-1746: absence of a workspace must be a HARDER failure than an unhealthy
  // one. The host-fallback path below lets advancing roles (review/test/ship)
  // proceed when the docker stack is merely unhealthy — but a workspace
  // directory that does not exist at all means the launcher would fall back to
  // its cwd ($HOME) and wedge Claude at the folder-trust prompt while it holds
  // an advancing slot against the PAN-1665 governor. Refuse the spawn outright
  // instead of degrading to host. (`work`'s resume path already guards this in
  // restartAgent; this closes the same gap on the role-run spawn path.)
  if (workspacePath && !existsSync(workspacePath)) {
    throw new Error(
      `Workspace for ${normalizedIssue} does not exist at ${workspacePath} — refusing to spawn ${role}. `
      + `A missing workspace would land the agent in $HOME at the folder-trust prompt. `
      + `Recreate the workspace ('pan workspace rebuild ${normalizedIssue}') before retrying.`,
    );
  }

  // PAN-4690: review only reads the committed diff, so it never needs the
  // workspace docker stack. Gating it on stack health made review dispatch
  // tear down and rebuild the stack (`up -d --build`) before spawning; a
  // dashboard restart in that window killed the rebuild and the spawn
  // together, and the review was never dispatched. Run on the host at once.
  if (role === 'review') return;

  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    spawnStackRebuildState.delete(normalizedIssue);
    return;
  }

  const details = health.reasons.join('; ');
  const message = `Workspace docker stack for ${normalizedIssue} is not healthy: ${details}. Run 'pan workspace rebuild ${normalizedIssue}' or retry with --host --yes to override.`;

  if (allowHost) {
    // PAN-1556: host-override is a per-spawn detail, not user-facing activity —
    // it fired once per convoy member and buried real feed items (conversations).
    // Keep the console.warn for debugging; do not emit to the session feed.
    console.warn(`[agents] ${message}`);
    return;
  }

  // PAN-1645 + PAN-1618: an unhealthy stack must NEVER *block* the advancing
  // roles. review/test/ship all operate on the HOST workspace — ship
  // rebases/pushes against the host .git, review reads the committed diff, and
  // test runs the project's quality gates (host-run unless a gate explicitly
  // opts into a container) — so they do not need the workspace's docker
  // containers at all. The long-standing manual `--host` workaround (PAN-1645)
  // burned enormous effort just rediscovering that ship-on-broken-docker is a
  // false gate. For these roles we still attempt one bounded autonomous rebuild
  // (so a project whose test gates DO run in containers gets a healthy stack
  // when recoverable), but if it can't be made healthy we AUTO-FALL-BACK TO
  // HOST and proceed instead of throwing.
  //
  // `work` is different: a work agent may rely on the dev container's services,
  // so silently running it on the host could build/test against a missing
  // environment. work keeps the hard gate (rebuild → escalate to a human).
  const hostFallbackEligible = role !== 'work';

  const record = spawnStackRebuildState.get(normalizedIssue)
    ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  const fallbackToHost = (reason: string): void => {
    console.warn(`[agents] ${message} — auto-falling back to host for ${role} (${reason})`);
    // Emit the host-fallback notice once per issue. Use a SEPARATE latch from
    // the work-escalation latch (`escalated`): if review/test/ship trip the
    // host fallback first, a later `work` spawn for the same broken-stack issue
    // must still be able to emit its own (error-level) dead-end marker — the
    // operator's only signal that a work agent is blocked on docker.
    if (!record.hostFallbackNoticed) {
      record.hostFallbackNoticed = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntry({
        source: role,
        level: 'warn',
        issueId: normalizedIssue,
        message: `agent-spawn-host-fallback: ${normalizedIssue}`,
        details: `Workspace docker stack unhealthy (${details}); ${role} spawn proceeds on the host without containers. ${reason}`,
      });
    }
  };

  // A review that requested changes means the work agent is explicitly being
  // restarted to repair known-broken code. Rebuilding its container stack would
  // compile the same broken branch and can only delay that repair, so work from
  // the host instead. PAN-3917: the verdict is the PR's, not a stored row.
  if (role === 'work' && (await getPrFacts(normalizedIssue)).changesRequested) {
    fallbackToHost('the pull request has changes requested; rework must repair the branch before its stack can build');
    return;
  }

  const blockWork = (markerMessage: string, errDetails: string): never => {
    if (!record.escalated) {
      record.escalated = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntry({
        source: role,
        level: 'error',
        issueId: normalizedIssue,
        message: markerMessage,
        details: errDetails,
      });
    }
    throw new Error(message);
  };

  if (record.attempts >= SPAWN_STACK_REBUILD_MAX_ATTEMPTS) {
    if (hostFallbackEligible) {
      fallbackToHost(`rebuild exhausted after ${record.attempts} attempts`);
      return;
    }
    blockWork(
      `agent-spawn-stack-rebuild-exhausted: ${normalizedIssue}`,
      `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${details}. Manual 'pan workspace rebuild ${normalizedIssue}' or retry with --host --yes needed.`,
    );
  }

  if (now - record.lastAttempt < SPAWN_STACK_REBUILD_COOLDOWN_MS) {
    // A rebuild was attempted recently and the stack is still unhealthy —
    // don't hammer `docker compose` every spawn.
    if (hostFallbackEligible) {
      fallbackToHost('rebuild on cooldown');
      return;
    }
    blockWork(`agent-spawn-blocked-stack-unhealthy: ${normalizedIssue}`, details);
  }

  // PAN-4961: a rebuild that would breach the disk floor is held; it counts no attempt.
  const diskHold = await resolveIssueStackDiskHold(issueId);
  if (diskHold) {
    if (hostFallbackEligible) { fallbackToHost(diskHold); return; }
    throw new Error(diskHold);
  }
  record.lastAttempt = now;
  record.attempts += 1;
  spawnStackRebuildState.set(normalizedIssue, record);
  console.log(
    `[agents] Workspace stack for ${normalizedIssue} unhealthy (${details}) — rebuilding ` +
      `before spawn (attempt ${record.attempts}/${SPAWN_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('../workspace/rebuild-stack.js');
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[agents]   ${normalizedIssue} stack rebuild: ${m}`),
    }),
  ).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err) }));

  if (result.success) {
    spawnStackRebuildState.delete(normalizedIssue);
    console.log(`[agents] Workspace stack for ${normalizedIssue} rebuilt — proceeding with spawn`);
    return;
  }

  console.warn(`[agents] Workspace stack rebuild failed for ${normalizedIssue}: ${result.error}`);
  if (hostFallbackEligible) {
    fallbackToHost(`rebuild failed: ${result.error ?? 'unknown'}`);
    return;
  }
  blockWork(`agent-spawn-stack-rebuild-failed: ${normalizedIssue}`, result.error ?? details);
}
