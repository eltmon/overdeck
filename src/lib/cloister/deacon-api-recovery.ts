import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { isContextOverflowTail } from '../context-overflow.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getAgentDir, getAgentRuntimeStateSync, getAgentStateSync, saveAgentRuntimeState } from '../agents.js';
import { markWorkspaceStuck } from '../overdeck/review-status-sync.js';
import { sessionFilePath } from '../paths.js';
import { getReviewStatusSync } from '../review-status.js';
import { capturePane, listSessionNames, sendKeys } from '../tmux.js';
import { isAgentIdleForNudge } from './agent-idle.js';

// ============================================================================
// API Error Recovery
// ============================================================================

/**
 * API error patterns that indicate transient server failures.
 * When an agent stops with one of these in its tmux output, it should
 * be nudged to retry rather than left idle.
 */
const API_ERROR_PATTERNS = [
  'API Error: The server had an error while processing your request',
  'API Error: Overloaded',
  'API Error: Rate limit',
  'API Error: Request was aborted',
  'API Error: Timed out',
  '529 Overloaded',
  '502 Bad Gateway',
  '503 Service Unavailable',
];

/**
 * Cooldown between API-error recovery nudges per agent.
 * Prevents spamming agents that are hitting persistent errors.
 */
const API_ERROR_RECOVERY_COOLDOWN_MS = 5 * 60_000; // 5 minutes

/**
 * Track API-error recovery attempts per agent.
 */
const apiErrorRecoveryState: Map<string, { lastAttempt: number }> = new Map();

/**
 * Context-window overflow is NOT a transient error. It surfaces as e.g.
 * "API Error: 400 Your input exceeds the context window of this model." and
 * nudging "continue" only re-sends the same oversized context for the same
 * 400. Recovery shrinks the context: agent-* sessions are summarized
 * out-of-band and respawned fresh with the summary as their opening prompt
 * (PAN-1781); specialist/planning sessions get the harness /compact plus a
 * continue nudge once it settles.
 *
 * This matters most for non-Anthropic models routed through CLIProxy
 * (e.g. gpt-5.5): Claude Code's native auto-compact is keyed to a context
 * window it can't determine for the proxied model, so it never fires and the
 * backend's own limit produces a hard 400 instead.
 */
/** Continuation nudge sent after a successful harness /compact (specialist/planning sessions). */
const CONTEXT_OVERFLOW_CONTINUE_MSG =
  'Your context was compacted to recover from a context-window overflow. ' +
  'Continue from where you left off using the compacted summary and your ' +
  'beads / continue.json — do NOT start over.';

/**
 * Let a recovery attempt finish before judging the result. MUST exceed the
 * patrol interval (60s): at exactly one interval the guard expires on the very
 * next patrol regardless of timer drift, which is how a still-settling
 * respawn used to get re-judged (and escalated) one tick after its compaction.
 * Compact respawns also spend ~30-60s generating the summary before the fresh
 * session even launches.
 */
const CONTEXT_COMPACT_SETTLE_MS = 150_000;

export const CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT = 85;
const CONTEXT_PROACTIVE_COMPACT_COOLDOWN_MS = 30 * 60_000;
const CONTEXT_PROACTIVE_IDLE_STALE_MS = 5 * 60_000;
/**
 * PAN-1781: proactive-compact cooldown stamp, persisted in the agent dir so a
 * dashboard restart doesn't forget an in-flight /compact and double-fire.
 */
const PROACTIVE_COMPACT_STAMP_FILE = 'last-proactive-compact';

/** Bounded compact-respawn attempts per overflow incident before marking stuck. */
const MAX_CONTEXT_COMPACT_ATTEMPTS = 2;

type ContextOverflowRecovery = {
  lastAttempt: number;
  compactAttempts: number;
  /**
   * How the last attempt recovered: 'respawn' = PAN-1781 fresh-seeded respawn
   * (agent-* sessions; the seed is the opening prompt, no follow-up nudge
   * needed); 'harness-compact' = /compact keystroke (specialist/planning
   * sessions; needs a continue nudge once the compaction settles).
   */
  mechanism: 'respawn' | 'harness-compact';
};

/**
 * Per-session context-overflow recovery state. Present only while a recovery
 * tier is in flight; deleted once the overflow clears (so a later overflow is
 * a fresh incident) or on escalation. Kept separate from apiErrorRecoveryState
 * so the transient-error path is untouched.
 */
export const contextOverflowRecoveryState: Map<string, ContextOverflowRecovery> = new Map();
export const contextProactiveCompactState: Map<string, { lastAttempt: number }> = new Map();

/**
 * PAN-1675 (A2): bounded native-compaction recovery for agents already flagged
 * `stuck` with reason `context_overflow`. These got stuck under the OLD
 * /compact+/clear ladder (which predates Overdeck-side compaction), so they
 * never received a native-compaction attempt — and the `overflowBlocked` gate
 * would otherwise skip their recovery forever. We give them a small, bounded
 * number of out-of-band compaction attempts; if the agent keeps overflowing
 * after that, it stays stuck for a human.
 */
export const stuckOverflowNativeRecoveryState: Map<string, { attempts: number; lastAttempt: number }> = new Map();
const MAX_STUCK_NATIVE_RECOVERY = 2;
const STUCK_NATIVE_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;

async function maybeProactivelyCompactContext(sessionName: string, now: number): Promise<string | null> {
  if (!sessionName.startsWith('agent-')) return null;
  // Cooldown: in-memory fast path, with an on-disk stamp fallback so a
  // dashboard restart doesn't forget a just-fired /compact and double-fire
  // into the still-compacting session (PAN-1781).
  let lastAttempt = contextProactiveCompactState.get(sessionName)?.lastAttempt ?? 0;
  if (!lastAttempt) {
    try {
      const stamp = await readFile(join(getAgentDir(sessionName), PROACTIVE_COMPACT_STAMP_FILE), 'utf-8');
      const parsed = Date.parse(stamp.trim());
      if (!Number.isNaN(parsed)) lastAttempt = parsed;
    } catch { /* no stamp yet */ }
  }
  if (lastAttempt && (now - lastAttempt) < CONTEXT_PROACTIVE_COMPACT_COOLDOWN_MS) return null;
  if (!isAgentIdleForNudge(sessionName, CONTEXT_PROACTIVE_IDLE_STALE_MS, now)) return null;

  const agentState = getAgentStateSync(sessionName);
  const runtimeState = getAgentRuntimeStateSync(sessionName);
  const sessionId = agentState?.sessionId ?? runtimeState?.claudeSessionId;
  if (!agentState?.workspace || !sessionId || !agentState.model) return null;

  let usage: { percentUsed: number } | null = null;
  try {
    const { computeContextUsage } = await import('../../dashboard/server/services/conversation-service.js');
    usage = await computeContextUsage(sessionFilePath(agentState.workspace, sessionId), agentState.model);
  } catch {
    return null;
  }
  if (!usage || usage.percentUsed < CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT) return null;

  await Effect.runPromise(sendKeys(sessionName, '/compact'));
  contextProactiveCompactState.set(sessionName, { lastAttempt: now });
  try {
    await writeFile(join(getAgentDir(sessionName), PROACTIVE_COMPACT_STAMP_FILE), new Date(now).toISOString(), 'utf-8');
  } catch { /* stamp is best-effort; in-memory cooldown still applies */ }
  emitActivityEntrySync({
    source: 'cloister',
    level: 'warn',
    message: `${sessionName} context window ${Math.round(usage.percentUsed)}% full — proactively compacting before the hard ceiling`,
    issueId: agentState.issueId,
  });
  return `Context high-water recovery: compacting ${sessionName} at ${Math.round(usage.percentUsed)}%`;
}

/**
 * Check for agents (work agents, specialists, planning) that stopped due
 * to transient API errors.
 *
 * Unlike stuck-thinking agents (which are actively processing), API-error
 * agents have stopped with the prompt showing. The tmux output contains
 * an error message from the provider. Recovery: send a "continue" nudge.
 */
export async function checkApiErrorAgents(): Promise<string[]> {
  const actions: string[] = [];
  const now = Date.now();

  // Check all tmux sessions — not just listRunningAgents() — because
  // specialist sessions aren't always in the agents registry.
  let sessionNames: readonly string[];
  try {
    sessionNames = await Effect.runPromise(listSessionNames());
  } catch {
    return actions;
  }

  const agentSessions = sessionNames.filter(
    name => name.startsWith('agent-') || name.startsWith('specialist-') || name.startsWith('planning-'),
  );
  // PAN-1818: convoy reviewer sub-role sessions (agent-<issue>-review-<subRole>)
  // are owned exclusively by monitorReviewConvoySignals(). checkApiErrorAgents
  // derives a garbage issueId from these names and would apply work-agent
  // compact-respawn, racing the monitor. Skip them here.
  const nonReviewerSessions = agentSessions.filter(
    name => !/^agent-.*-review-(?:security|correctness|performance|requirements)$/.test(name),
  );

  for (const sessionName of nonReviewerSessions) {
    const recovery = apiErrorRecoveryState.get(sessionName);
    if (recovery && (now - recovery.lastAttempt) < API_ERROR_RECOVERY_COOLDOWN_MS) {
      continue;
    }

    let tmuxOutput: string;
    try {
      tmuxOutput = await Effect.runPromise(capturePane(sessionName, 100));
    } catch {
      continue;
    }

    if (!tmuxOutput.trim()) continue;

    const hasPrompt = tmuxOutput.includes('❯');
    if (!hasPrompt) continue;

    // ── Context-window overflow recovery (distinct from transient errors) ──
    // A 400 "input exceeds the context window" cannot be retried by continuing.
    // Recover by compacting; once the compaction has settled and the overflow
    // is gone, nudge the agent to resume. A loop guard escalates to stuck if
    // /compact never clears the overflow.
    {
      const issueId = sessionName.startsWith('agent-')
        ? sessionName.replace('agent-', '').toUpperCase()
        : null;
      const overflowBlocked = (() => {
        if (!issueId) return false;
        const st = getReviewStatusSync(issueId);
        return Boolean(st?.stuck || st?.deaconIgnored);
      })();
      const ov = contextOverflowRecoveryState.get(sessionName);
      // Judge overflow from only the recent tail: the error sits adjacent to the
      // idle prompt when an agent stops, and after a /compact redraw the old
      // error scrolls past this window — so a settled /compact that cleared the
      // overflow won't be misread as "still overflowing" from stale scrollback.
      const hasOverflow = isContextOverflowTail(tmuxOutput);
      const runtimeState = getAgentRuntimeStateSync(sessionName);
      if (hasOverflow) {
        if (!runtimeState?.contextSaturatedAt) {
          await saveAgentRuntimeState(sessionName, { contextSaturatedAt: new Date(now).toISOString() });
          emitActivityEntrySync({
            source: 'cloister',
            level: 'warn',
            message: `${sessionName} marked wedged: context-window overflow detected`,
            issueId: issueId ?? undefined,
          });
        }
      } else if (runtimeState?.contextSaturatedAt) {
        await saveAgentRuntimeState(sessionName, { contextSaturatedAt: undefined });
      }

      // PAN-1675 (A2): rescue agents already flagged stuck=context_overflow.
      // The old /compact+/clear ladder set `stuck` and the `overflowBlocked`
      // gate below then skips their recovery permanently — but those agents
      // never got a Overdeck-side (out-of-band) compaction, which can recover
      // an overflow the harness /compact could not. Give them a bounded number
      // of native-compaction attempts BEFORE the overflowBlocked gate. A
      // successful resumeAgent({compact:true}) clears the stuck flag (in
      // resumeAgent), so a recovered agent re-enters the normal flow. deacon-
      // ignored issues are still left alone.
      {
        const stuckStatus = issueId ? getReviewStatusSync(issueId) : null;
        const isStuckOverflow = Boolean(
          stuckStatus?.stuck && stuckStatus.stuckReason === 'context_overflow' && !stuckStatus.deaconIgnored,
        );
        if (isStuckOverflow) {
          if (!hasOverflow) {
            // The tail no longer shows the overflow error — but that is a WEAK
            // signal: the 400 line can scroll out of the captured window while
            // the agent is still pinned near 100% context. Only clear the stuck
            // flag on a POSITIVE recovery signal — the agent's actual JSONL
            // context usage is back below the proactive high-water mark.
            // Otherwise leave it stuck: a genuinely-full agent must not be
            // returned to the pipeline on a tail-string miss only to re-overflow
            // on its next turn (the false-recovery flap).
            let recoveredPct: number | null = null;
            try {
              const st = getAgentStateSync(sessionName);
              const sid = st?.sessionId ?? runtimeState?.claudeSessionId;
              if (st?.workspace && sid && st.model) {
                const { computeContextUsage } = await import('../../dashboard/server/services/conversation-service.js');
                const usage = await computeContextUsage(sessionFilePath(st.workspace, sid), st.model);
                if (usage && usage.percentUsed < CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT) {
                  recoveredPct = usage.percentUsed;
                }
              }
            } catch { /* treat as not-yet-recovered — leave it stuck */ }
            if (recoveredPct !== null) {
              const { clearWorkspaceStuck } = await import('../overdeck/review-status-sync.js');
              clearWorkspaceStuck(issueId!);
              stuckOverflowNativeRecoveryState.delete(sessionName);
              actions.push(`Context overflow recovery: cleared stuck flag for ${sessionName} (context back to ${Math.round(recoveredPct)}%)`);
            }
            continue;
          }
          const rec = stuckOverflowNativeRecoveryState.get(sessionName) ?? { attempts: 0, lastAttempt: 0 };
          if (rec.attempts >= MAX_STUCK_NATIVE_RECOVERY) {
            // Native compaction tried its budget and the agent keeps
            // overflowing — genuinely needs a human; leave it stuck.
            continue;
          }
          if (rec.lastAttempt && (now - rec.lastAttempt) < STUCK_NATIVE_RECOVERY_COOLDOWN_MS) {
            continue;
          }
          rec.attempts += 1;
          rec.lastAttempt = now;
          stuckOverflowNativeRecoveryState.set(sessionName, rec);
          const { resumeAgent } = await import('../agents.js');
          const recovered = await resumeAgent(sessionName, undefined, { compact: true });
          if (recovered.success) {
            stuckOverflowNativeRecoveryState.delete(sessionName);
            emitActivityEntrySync({
              source: 'cloister',
              level: 'warn',
              message: `${sessionName} recovered from a stuck context-overflow via Overdeck-side compaction (attempt ${rec.attempts})`,
              issueId: issueId ?? undefined,
            });
            console.log(`[deacon] Agent ${sessionName} recovered from stuck context-overflow via native compaction (attempt ${rec.attempts})`);
            actions.push(`Context overflow recovery: native-compacted previously-stuck ${sessionName} (attempt ${rec.attempts})`);
            continue;
          }
          // Respawn failed — a spawn-level error (seed generation never fails:
          // it degrades to a reseed-only seed inside resumeAgent). PAN-1781
          // removed the /clear keystroke tier; the bounded retry budget +
          // cooldown above covers transient spawn failures, and an exhausted
          // budget correctly leaves the agent stuck for a human.
          console.warn(`[deacon] Compact respawn failed for stuck ${sessionName} (${recovered.error ?? 'unknown'}; attempt ${rec.attempts}/${MAX_STUCK_NATIVE_RECOVERY})`);
          actions.push(`Context overflow recovery: compact respawn failed for stuck ${sessionName} (attempt ${rec.attempts})`);
          continue;
        }
      }

      if (!overflowBlocked) {
        if (ov && (now - ov.lastAttempt) < CONTEXT_COMPACT_SETTLE_MS) {
          // A recovery tier is in flight — give it time to finish before judging.
          continue;
        }

        if (ov && !hasOverflow) {
          // The previous tier cleared the overflow. A harness /compact leaves
          // the agent idle at the compacted summary, so nudge it to resume. A
          // PAN-1781 fresh-seeded respawn needs no nudge — its seed (summary +
          // reseed instructions) IS the opening prompt.
          if (ov.mechanism === 'harness-compact') {
            try {
              await Effect.runPromise(sendKeys(sessionName, CONTEXT_OVERFLOW_CONTINUE_MSG));
              console.log(`[deacon] Agent ${sessionName} resumed after context-overflow compaction`);
              actions.push(`Context overflow recovery: resumed ${sessionName} after compaction`);
            } catch (err) {
              console.error(`[deacon] Failed to resume ${sessionName} after compaction:`, err);
            }
          } else {
            actions.push(`Context overflow recovery: ${sessionName} recovered after compact respawn`);
          }
          contextOverflowRecoveryState.delete(sessionName);
          continue;
        }

        if (hasOverflow) {
          // Loop guard: a bounded number of compact attempts per incident, then
          // escalate to stuck for a human. PAN-1781 removed the /clear keystroke
          // tier — a respawn that still overflows means something is deeply
          // wrong (e.g. summarization producing oversized seeds), and blowing
          // away the context with /clear just hides it.
          if (ov && ov.compactAttempts >= MAX_CONTEXT_COMPACT_ATTEMPTS) {
            if (issueId) {
              markWorkspaceStuck(issueId, 'context_overflow', {
                compactAttempts: ov.compactAttempts,
              });
            }
            emitActivityEntrySync({
              source: 'cloister',
              level: 'error',
              message: `${sessionName} stuck: context-window overflow persisted after ${ov.compactAttempts} compact-recovery attempts`,
              issueId: issueId ?? undefined,
            });
            console.error(`[deacon] Agent ${sessionName} stuck after ${ov.compactAttempts} compact-recovery attempts — escalating`);
            contextOverflowRecoveryState.delete(sessionName);
            continue;
          }

          const compactAttempts = (ov?.compactAttempts ?? 0) + 1;

          // PAN-1781: agent-* sessions recover via summarize + fresh-seeded
          // respawn (resumeAgent({compact:true})): the wedged session is
          // summarized out-of-band and a FRESH session is spawned with that
          // summary as its opening prompt. Never the harness `/compact` (which
          // deadlocks past the ceiling) and never an in-place JSONL boundary +
          // --resume (which the harness's resume leaf selection bypassed ~half
          // the time, silently rebuilding the full overflowed context — the
          // root cause behind every "compaction didn't work → /clear" incident
          // up to PAN-1775). Attempts are counted on failure too, so a
          // persistently failing respawn exhausts the budget and escalates
          // instead of retrying forever.
          if (issueId !== null) {
            const { resumeAgent } = await import('../agents.js');
            const resumeResult = await resumeAgent(sessionName, undefined, { compact: true });
            contextOverflowRecoveryState.set(sessionName, {
              lastAttempt: now,
              compactAttempts,
              mechanism: 'respawn',
            });
            if (resumeResult.success) {
              emitActivityEntrySync({
                source: 'cloister',
                level: 'warn',
                message: `${sessionName} hit context-window overflow — respawned fresh with a compact-summary seed (attempt ${compactAttempts})`,
                issueId: issueId ?? undefined,
              });
              console.log(`[deacon] Agent ${sessionName} hit context-window overflow — compact-respawned (attempt ${compactAttempts})`);
              actions.push(`Context overflow recovery: compact-respawned ${sessionName} (attempt ${compactAttempts})`);
            } else {
              emitActivityEntrySync({
                source: 'cloister',
                level: 'warn',
                message: `${sessionName} compact respawn failed (${resumeResult.error ?? 'unknown'}) — will retry after settle (attempt ${compactAttempts}/${MAX_CONTEXT_COMPACT_ATTEMPTS})`,
                issueId: issueId ?? undefined,
              });
              console.warn(`[deacon] Compact respawn failed for ${sessionName} (${resumeResult.error ?? 'unknown'}; attempt ${compactAttempts}/${MAX_CONTEXT_COMPACT_ATTEMPTS})`);
              actions.push(`Context overflow recovery: compact respawn failed for ${sessionName} (attempt ${compactAttempts})`);
            }
            continue;
          }

          // Non-agent (specialist/planning) sessions are not registered agents,
          // so the respawn path doesn't apply — keep the harness /compact tier.
          try {
            await Effect.runPromise(sendKeys(sessionName, '/compact'));
            contextOverflowRecoveryState.set(sessionName, {
              lastAttempt: now,
              compactAttempts,
              mechanism: 'harness-compact',
            });
            emitActivityEntrySync({
              source: 'cloister',
              level: 'warn',
              message: `${sessionName} hit context-window overflow — compacting to recover (attempt ${compactAttempts})`,
              issueId: issueId ?? undefined,
            });
            console.log(`[deacon] Agent ${sessionName} hit context-window overflow — sent /compact (attempt ${compactAttempts})`);
            actions.push(`Context overflow recovery: compacting ${sessionName} (attempt ${compactAttempts})`);
          } catch (err) {
            console.error(`[deacon] Failed to send /compact to ${sessionName}:`, err);
          }
          continue;
        }

        if (!ov && !hasOverflow) {
          const proactiveAction = await maybeProactivelyCompactContext(sessionName, now);
          if (proactiveAction) {
            actions.push(proactiveAction);
            continue;
          }
        }
      }
    }

    const hasApiError = API_ERROR_PATTERNS.some(pattern => tmuxOutput.includes(pattern));
    if (!hasApiError) continue;

    // For work agents, respect stuck/deacon-ignored flags
    if (sessionName.startsWith('agent-')) {
      const agentIssueId = (sessionName.replace('agent-', '')).toUpperCase();
      const agentReviewStatus = getReviewStatusSync(agentIssueId);
      if (agentReviewStatus?.stuck || agentReviewStatus?.deaconIgnored) {
        continue;
      }
    }

    console.log(`[deacon] Agent ${sessionName} stopped with API error — nudging retry`);

    try {
      const continueMsg = 'You stopped due to a transient API error. This is a temporary server issue, not a problem with your work. Continue from where you left off. Do NOT start over — pick up exactly where you stopped.';
      await Effect.runPromise(sendKeys(sessionName, continueMsg));
      apiErrorRecoveryState.set(sessionName, { lastAttempt: now });
      actions.push(`API error recovery: nudged ${sessionName} to retry`);
    } catch (err) {
      console.error(`[deacon] Failed to nudge ${sessionName} for API error retry:`, err);
    }
  }

  return actions;
}

