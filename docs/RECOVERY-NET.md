# Recovery Net

The Deacon treats recovery as a durable obligation, not a one-shot event:

1. Derive the owed action from permanent records, tracker state, agent state,
   tmux liveness, and pane content.
2. Classify agent gates with `getAgentResumeGateBlockReason()`.
3. Apply `decideResumeGate(gate, intent)` for `autonomous`, `operator-start`, or
   `message-delivery` intent.
4. Admit autonomous work through `decideAutonomousRedrive()`: cached memory
   verdict first, then the role concurrency reservation.
5. Re-drive through the existing door: review obligation, planning-to-work,
   stack rebuild, dead-session respawn, or swarm redispatch.
6. Persist breaker identity `{ issue, recoveryPath, obligationGeneration,
   tripCount }`; emit needs-you once per open trip.

The recovery net also reconciles durable verdicts, terminal agent rows, and
pipeline labels on deterministic patrol cadence. Signal commands write durable
state before bounded advisory network calls and exit explicitly.

Failed swarm slots are archived under timestamped `slot-N-failed-*` branch and
worktree names and redispatched on a higher monotonic index. Patrol reconcile and
GC ignore those names for occupancy and never delete them. They remain available
for debugging until configured issue close-out removes all issue worktrees and
branches.

Known Codex rate-limit dialogs are answered with Down then Enter to select
“Keep current model”; bare Enter is forbidden because it confirms the downgrade.
Until a captured model-switch fixture proves rollout JSONL authoritative after a
live switch, JSONL model values are launch/turn attribution only and pane-observed
switch banners trigger a needs-you halt.
