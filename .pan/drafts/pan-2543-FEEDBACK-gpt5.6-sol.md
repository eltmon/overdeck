# PAN-2543 PRD second-eyes review — gpt5.6-sol

Reviewed against `main` and all fourteen source issue bodies/comments on 2026-07-09. Findings below identify behavioral contradictions or missing source requirements.

## 1. BLOCKER — D2 reverses PAN-2536's required autonomous-recovery behavior

PAN-2536 explicitly requires a review/test-failed agent with `stoppedByUser: true` to be recovered by the PAN-2520 autonomous rebuild-and-start path, and names that as an acceptance criterion. D2 instead says `stoppedByUser` blocks **all autonomous** re-drive and produces one needs-you (`.pan/drafts/pan-2543.md:46-48`, FR-1 at `:64`). WI-1 repeats that behavior. The epic therefore cannot close PAN-2536 under WI-16 while meeting the source issue's acceptance criteria.

There is already a narrower semantic distinction in code: a plain user-killed agent stays stopped, while a done-handoff agent with failed review is auto-resumed despite `stoppedByUser` (`src/lib/cloister/__tests__/pan-871-auto-resume.test.ts:418-462`).

Required correction: replace the blanket rule with an intent-aware matrix. At minimum distinguish (a) explicit mid-work operator stop with no completed handoff, which must stick, from (b) pipeline completion/done handoff followed by failed review/test, which carries a durable rework obligation and may autonomously re-drive. State exactly how the PAN-2536 historical poisoned flag is classified and add matrix cases for completed marker × pending rework × stoppedByUser.

## 2. BLOCKER — D13's preservation rule makes the slot index impossible to free

WI-8 says preserve the dead slot branch/worktree, clear its assignment, and let `dispatchNextWave` refill the slot (`.pan/drafts/pan-2543.md:166-172`). Current dispatch deliberately marks **every local slot branch** occupied (`src/lib/cloister/deacon-swarm.ts:747-755`) and separately marks orphaned on-disk slot worktrees occupied (`:757-764`). Clearing only the durable assignment cannot free the index; preserving both branch and worktree guarantees redispatch finds no capacity.

Required correction: choose and specify one work-preserving mechanism that dispatch understands: resume/recreate the same agent on the same slot worktree; allocate a new monotonically increasing slot index while retaining the old artifacts; or archive/rename the failed branch/worktree before reuse. Define how `recordSlotAssignment`, `reconcileSlotState`, overlap detection, and GC represent the superseded attempt. Add a fixture with the real branch + worktree + assignment occupancy combination, not an assignment-only mock.

## 3. HIGH — the shared gate contract conflates autonomous admission with explicit transitions

D1 extends `getAgentResumeGateBlockReason`, which is currently used by the fundamental running-state assertion (`src/lib/agents/agent-state.ts:679-697`) and messaging/start surfaces, not only autonomous reconcilers. The proposed union also adds `failure-backoff`, while D2 says explicit starts clear only `stoppedByUser`. If the same predicate blocks `assertAgentCanTransitionToRunning`, an operator `pan start` during failure backoff remains blocked even though D2 declares explicit action authoritative. Conversely, callers that should merely suppress autonomous dispatch now inherit message-delivery and explicit-start semantics.

Required correction: define two mechanically related APIs: a pure gate-state classifier and a policy decision parameterized by intent (`autonomous` vs explicit operator action). Enumerate which gates explicit actions clear, which they may override, and which require a separate command (`unpause`, `untroubled`). Test the actual CLI/dashboard paths, not only eight state booleans against a context-free predicate.

## 4. HIGH — PAN-2534 requirements FR-2 and FR-3 are not implemented by WI-5

The source issue requires: (1) force replacement on `pan review request`; (2) review agents terminate or are reaped after emitting a verdict; and (3) a patrol notices HEAD advanced beyond the last-reviewed SHA even if no usable request event survives. WI-5 covers only stale-session replacement when a re-review request reaches dispatch (`.pan/drafts/pan-2543.md:148-151`). It adds neither verdict-terminal session cleanup nor an independent current-HEAD-vs-reviewed-SHA reconciler.

Required correction: add the post-verdict termination/reaper behavior and the durable review-obligation patrol. The patrol must derive “current HEAD lacks a review” from durable request/review metadata, not require the lost event whose recovery the issue asks for. Add a multi-round rework test proving no manual kill is needed.

## 5. HIGH — PAN-2503's event-driven close-out prune is omitted

PAN-2503 asks for event-driven pruning when close-out finalizes, with a periodic janitor only as backstop. WI-12 implements manual/scheduled GC but no close-out hook (`.pan/drafts/pan-2543.md:197-200`). That leaves the primary accumulation path intact until the hourly sweep and weakens the source issue's “runtime table reflects in-flight now” contract.

Required correction: add a canonical-writer close-out action that removes all stopped rows for the issue immediately after the permanent close-out record is durable, while preserving any live session as an explicit failure/escalation. Keep the hourly sweep for externally closed/bypass cases. Test close-out event pruning separately from scheduled GC.

## 6. HIGH — needs-you dedup lifetime is undefined and can suppress later genuine trips

D2/D3 require exactly one needs-you “per issue per trip,” but WI-1 proposes reusing the dead-end cooldown map and no work item defines durable trip identity or when dedup resets. A process-local issue-keyed cooldown can duplicate after restart and can also suppress a later, distinct breaker trip for the same issue.

Required correction: persist a breaker/trip key containing issue, recovery path, obligation generation (for example reviewed HEAD/run ID), and trip count in the issue record. Define acknowledgement/reset semantics for explicit operator actions. Test restart during an open trip and a second trip after recovery.

## 7. HIGH — WI-10's model-divergence source may only prove the launch model, not the live downgraded model

WI-10 proposes reading rollout/transcript JSONL metadata to compare recorded vs live model (`.pan/drafts/pan-2543.md:179-186`), but the incident is a TUI-mediated in-session switch. The PRD does not verify that either JSONL source updates its model field after that dialog; session metadata commonly records launch configuration. If it does not update, the promised divergence detector reports equality during the exact silent downgrade it is meant to catch.

Required correction: make this an implementation checkpoint with a captured before/after dialog fixture. Identify an authoritative post-switch field/event or remove the claim that divergence is observable. The acceptance test must simulate an actual model-switch event in recorded session output, not two hand-constructed unequal strings.

