# PAN-2147 — Thin `routes/agents.ts` (4,071 lines) behind the two doors

**Issue:** https://github.com/eltmon/overdeck/issues/2147
**Verified-Against:** main @ `bc95c5956c6ea9a47f7e5629ac3f0772be0853c3`
**Queue phase:** Phase 2 — route thinning (item 10 of `docs/codebase-health/REFACTOR-QUEUE.md`)
**Status:** draft

> **Approach override (orchestrator decision, 2026-07-02):** the issue body asks for a
> barrel split; that approach is REJECTED (it created `merge-ops.ts`, 1,925 lines, in the
> workspaces split). This PRD supersedes the issue body: **route thinning via the two-door
> tenet** — domain logic moves to new `src/lib/overdeck/agent-*.ts` door modules;
> `routes/agents.ts` keeps all registrations and ends under 1,000 lines; moved symbols'
> importers are repointed in the same PR, no re-export shims.
>
> Execute PAN-2148 (issues.ts) first — it establishes the identical recipe and moves an
> import out of `routes/issues.ts` that this PRD's §2.2 tracks. Verify every anchor by
> grep; line numbers are hints valid only at the sha above.

---

## 0. Glossary

- **Two-door tenet / thin adapter / door module / repoint / no-loss audit / TENET-10** —
  identical definitions to `.pan/drafts/PAN-2148.md` §0; read that PRD first, this one
  assumes it.
- **`src/lib/overdeck/agents.ts`** — the EXISTING agents door skeleton, **1,075 lines and
  baselined** in `scripts/file-size-baseline.txt` (`1075 src/lib/overdeck/agents.ts`): it
  may NOT grow. All extractions land in NEW `src/lib/overdeck/agent-<seam>.ts` files.
- **Transport validator** — a helper whose signature takes
  `HttpServerRequest.HttpServerRequest` and returns an ok/response decision. These are
  transport, not domain: they STAY in the route file. Verified members:
  `validateAgentRuntimeEventAuth` (anchor:
  `export async function validateAgentRuntimeEventAuth`), `validateAgentMessageOrigin`,
  `validateAgentDeliveryMethodOrigin`.
- **Message-like factory** — `function postAgentMessageLikeRoute(path:` builds the POST
  handler shared by `/api/agents/:id/message` and `/api/agents/:id/tell` (anchors:
  `postAgentMessageLikeRoute('/api/agents/:id/message')` and `…('/api/agents/:id/tell')`).
  The factory shell (routing + origin check) stays; its delivery body moves.
- **Start-agent monster** — the `POST /api/agents` handler, ~1,094 lines (from anchor
  `'/api/agents',` with method `'POST'` down to the `tmux-alive` route) — the largest
  single handler in the server.

---

## 1. Problem (verified evidence)

`src/dashboard/server/routes/agents.ts` is 4,071 lines (baselined at 4,071), the server's
#1 route god file. It carries 39 runtime routes across at least six domains (listing,
monitoring reads, messaging, pipeline signals, lifecycle operations, spawn), a ~1,094-line
start-agent handler with no internal section structure (verified: zero `// ───` section
comments inside it), and 16 public exports consumed by two other route files and several
tests. Every agent-lifecycle change lands here.

---

## 2. No-loss audit

### 2.1 Routes (39 at runtime — all stay registered in `routes/agents.ts`)

Enumerated from the `HttpRouter.add` sites + the two factory instantiations, cross-checked
against `export const agentsRouteLayer = Layer.mergeAll(`. Re-verify the list at execution
(§8.2).

| Method | Path | Purpose | Door for its logic |
|---|---|---|---|
| GET | `/api/agents` | list agents (cached) | `agent-list.ts` |
| GET | `/api/agents/:id/output` | pane/session output | `agent-monitor-reads.ts` |
| GET | `/api/agents/:id/conversation` | conversation view (`buildConversationResponse`) | `agent-monitor-reads.ts` |
| POST | `/api/agents/:id/message` | deliver a message (factory) | `agent-messaging.ts` |
| POST | `/api/agents/:id/tell` | deliver a message, tell alias (factory) | `agent-messaging.ts` |
| GET | `/api/agents/:id/health-history` | health snapshots | `agent-monitor-reads.ts` |
| POST | `/api/agents/:id/poke` | nudge a stalled agent | `agent-messaging.ts` |
| GET | `/api/agents/:id/pending-questions` | pending AskUserQuestions | `agent-messaging.ts` |
| POST | `/api/agents/:id/answer-question` | answer an AskUserQuestion | `agent-messaging.ts` |
| POST | `/api/agents/:id/heartbeat` | hook heartbeat signal | `agent-signals.ts` |
| POST | `/api/agents/:id/work-complete` | completion signal | `agent-signals.ts` |
| POST | `/api/agents/:id/stuck` | stuck signal | `agent-signals.ts` |
| POST | `/api/agents/:id/classify-completion` | classify a completion | `agent-signals.ts` |
| POST | `/api/internal/agents/:id/permissions/request` | permission request (internal token) | `agent-signals.ts` |
| POST | `/api/agents/:id/permissions/:requestId/respond` | permission decision | `agent-signals.ts` |
| GET | `/api/agents/:id/runtime` | runtime state read | `agent-monitor-reads.ts` |
| GET | `/api/agents/:id/git-info` | branch/worktree info (`agentHasResolvableWorkspace`, `UNRESOLVABLE_AGENT_GIT_INFO`) | `agent-monitor-reads.ts` |
| GET | `/api/agents/:id/activity` | activity log read | `agent-monitor-reads.ts` |
| GET | `/api/agents/:id/files` | changed-files read | `agent-monitor-reads.ts` |
| GET | `/api/agents/:id/timeline` | timeline read | `agent-monitor-reads.ts` |
| POST | `/api/agents/:id/suspend` | suspend agent | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/pause` | persistent pause gate | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/unpause` | clear pause gate | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/untroubled` | clear troubled gate | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/resume` | resume stopped agent | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/recover` | recover wedged agent | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/restart` | restart agent | `agent-lifecycle-ops.ts` |
| POST | `/api/agents/:id/restart-fresh` | restart with fresh session | `agent-lifecycle-ops.ts` |
| GET | `/api/agents/:id/cloister-health` | cloister view of agent health | `agent-monitor-reads.ts` |
| GET | `/api/agents/:id/handoff/suggestion` | handoff focus suggestion | `agent-session-ops.ts` |
| POST | `/api/agents/:id/handoff` | spawn handoff conversation | `agent-session-ops.ts` |
| GET | `/api/agents/:id/cost` | per-agent cost | `agent-monitor-reads.ts` |
| POST | `/api/agents` | **start-agent monster** | `agent-start.ts` (+ support, WI-7) |
| GET | `/api/agents/:id/tmux-alive` | session liveness | `agent-monitor-reads.ts` |
| POST | `/api/agents/restart-all` | restart all agents | `agent-lifecycle-ops.ts` |
| GET | `/api/agents/:id/has-session` | JSONL session presence | `agent-monitor-reads.ts` |
| POST | `/api/agents/:id/reset-session` | reset session id | `agent-session-ops.ts` |
| POST | `/api/agents/:id/delivery-method` | set delivery method | `agent-session-ops.ts` |
| POST | `/api/agents/:id/switch-model` | switch agent model | `agent-session-ops.ts` |

### 2.2 Public exports (verified via `grep -n "^export " src/dashboard/server/routes/agents.ts`)

| Export | Disposition | Importers to repoint |
|---|---|---|
| `buildPanStartArgs`, `spawnPanCommandDetached`, `evaluateAgentStartGate`, `hasActiveAgentGateOrRetry`, `evaluateSpawnGuardrails`, `SpawnGuardrailDecision`, `AgentStartGateDecision` | → `agent-start-support.ts` | tests only — find with `git grep -ln "buildPanStartArgs\|evaluateAgentStartGate\|evaluateSpawnGuardrails" tests/ src/**/__tests__` and repoint each |
| `invalidateAgentsCache` | → `agent-list.ts` | `src/dashboard/server/routes/issues.ts` (anchor: `import { invalidateAgentsCache } from './agents.js';`) — **PAN-2148 may have relocated this import into a door module; repoint wherever it lives now** |
| `buildConversationResponse` | → `agent-monitor-reads.ts` | verify with `git grep -n "buildConversationResponse"` |
| `createAgentStopHandler` | → `agent-lifecycle-ops.ts` (move with its in-file users) | verify users first: `git grep -n "createAgentStopHandler"` |
| `agentHasResolvableWorkspace`, `UNRESOLVABLE_AGENT_GIT_INFO` | → `agent-monitor-reads.ts` | verify with git grep |
| `validateAgentRuntimeEventAuth`, `validateAgentMessageOrigin`, `validateAgentDeliveryMethodOrigin` | **STAY** in `routes/agents.ts` (transport validators — D3) | `src/dashboard/server/routes/specialists.ts` (anchor: `import { validateAgentRuntimeEventAuth } from './agents.js';`) — untouched |
| `agentsRouteLayer` + default export | stay | `src/dashboard/server/server.ts` — untouched |

### 2.3 Tests referencing `routes/agents` (verified sweep)

- `tests/unit/dashboard/routes/dashboard-continue-readers.test.ts` — **git-grep ACs
  pinned to this file** (anchor: `git grep -n "appendSessionEntry" -- src/dashboard/server/routes/agents.ts`):
  AC1 asserts `readWorkspaceContinueState`/`writeWorkspaceContinueState` ABSENT and
  `appendSessionEntry` PRESENT in `routes/agents.ts`. When the code using
  `appendSessionEntry` moves to a door module, repoint the grep pathspec to the new
  owner(s) **keeping each assertion's meaning** (absent stays absent everywhere;
  present points at the new home). Same PR.
- `tests/unit/lib/pan-1908-no-loss-audit.test.ts` — reads
  `src/dashboard/server/routes/agents.ts` source (anchor:
  `const routePath = join(process.cwd(), 'src/dashboard/server/routes/agents.ts');`);
  repoint the read at whichever door module now owns the asserted symbols, preserving
  the audit's meaning.
- `tests/integration/agent-spawning.test.ts` — imports come from `src/lib/agents`
  (verified), not this route file; its `routes/agents` mention is incidental. Verify and
  leave unless an import actually breaks.

---

## 3. Locked design decisions

- **D1 — Same recipe as PAN-2148** (route file keeps all registrations; fat handler
  bodies become door functions; handlers ≤~40 lines; one seam per commit; full suite
  before merge). Where this PRD is silent, PAN-2148's decisions apply.
- **D2 — New door modules only; `src/lib/overdeck/agents.ts` must not grow** (it is
  baselined at 1,075). Modules: `agent-list.ts`, `agent-monitor-reads.ts`,
  `agent-messaging.ts`, `agent-signals.ts`, `agent-lifecycle-ops.ts`,
  `agent-session-ops.ts`, `agent-start.ts`, `agent-start-support.ts` — each <1,000 lines.
- **D3 — Transport validators stay in the route file.** They take `HttpServerRequest`
  and produce HTTP responses — moving them would make a lib module transport-aware.
  Consequence: `specialists.ts`'s import is untouched.
- **D4 — Start-agent split rule (the monster has no comment seams — verified).** Move
  the `POST /api/agents` body to `agent-start.ts` as `startAgent(opts)`. If the
  relocated module would exceed 1,000 lines (likely: body ≈1,094), extract the
  contiguous top-level phases into named functions IN THE SAME MODULE FAMILY
  (`agent-start-support.ts`): guardrail/gate evaluation, workspace ensure, plan/beads
  validation, spawn dispatch, response assembly. Extraction is cut-at-`yield*`-boundary
  only — each extracted function is a contiguous block whose inputs/outputs are the
  variables crossing the cut; no reordering, no logic edits. **Implementation
  checkpoint:** record the chosen cut points (function names + first-line anchors) in
  the PR description; fallback if a clean cut cannot keep both files <1,000 — three-way
  split (`agent-start.ts`, `agent-start-workspace.ts`, `agent-start-support.ts`),
  reported the same way.
- **D5 — Messaging factory:** `postAgentMessageLikeRoute` stays (it IS routing); the
  handler body inside it (delivery + transcript confirmation flow) moves to
  `agent-messaging.ts` as `deliverAgentRouteMessage(...)` and the factory calls it.
- **D6 — `lint:state-writes` is a hard invariant.** The guard scans ALL of `src/` for
  continue-file literals (anchor in `scripts/lint-state-writes.sh`:
  `CONTINUE_EXCLUDES=(`) — a pure move is neutral, but do NOT introduce any new
  `continue.json`/`continuePath` literal in door modules. `npm run lint` must keep
  printing the state-write pass line after every seam.
- **D7 — Baseline handling identical to PAN-2148 D6:** lower `routes/agents.ts`'s entry
  (4,071) in the same PR; no new file may need a baseline entry.
- **D8 — Fallback if the thinned route file still exceeds 1,000 lines** (39 thin
  handlers + validators + factory ≈ 900, so this should not trigger): move ONLY the GET
  read registrations to `routes/agents-reads.ts` merged into `agentsRouteLayer` from
  `agents.ts` — thin registrations, never fat handlers. Use only as a last resort and
  say so in the PR.

---

## 4. Requirements

- **FR-1** All 39 routes keep identical method+path+behavior; `agentsRouteLayer` still
  composes them all from `routes/agents.ts`.
- **FR-2** Every §2.2 "move" export lives in its named door module with all importers
  repointed; the three transport validators remain in the route file;
  `git grep -n "from './agents.js'" src/dashboard/server/routes/` afterward shows only
  `specialists.ts` (validator) — and any door-module imports PAN-2148 created.
- **FR-3** `routes/agents.ts` < 1,000 lines; every new door module < 1,000 lines;
  `src/lib/overdeck/agents.ts` unchanged in size or content.
- **FR-4** Pure moves: no logic edits, renames, or signature changes except the D4
  phase-extraction cuts and D5 factory-body extraction, both behavior-preserving.
- **FR-5** No-loss audit test asserts all 39 method+path pairs remain registered.
- **NFR-1..3** identical to PAN-2148 (any-allowlist additions audited with this issue's
  ref; async-only server code; full `npm test` before merge per TENET-10).
- **NFR-4** `lint:state-writes` passes after every seam (D6).

---

## 5. Work items (one seam = one commit, safest first)

Recipe per seam as PAN-2148 §5. Named gate for each: typecheck+lint+build + the seam's
repointed tests.

- **WI-1 — `agent-monitor-reads.ts`** *(13 GET routes per §2.1)* — move handler bodies +
  `buildConversationResponse`, `agentHasResolvableWorkspace`,
  `UNRESOLVABLE_AGENT_GIT_INFO`. Largest-coverage, lowest-risk seam (reads only).
- **WI-2 — `agent-list.ts`** *(GET `/api/agents`)* — move the list handler body, the
  agents cache internals, and `invalidateAgentsCache`; repoint the issues-side import
  (wherever PAN-2148 left it).
- **WI-3 — `agent-messaging.ts`** *(message, tell, poke, pending-questions,
  answer-question)* — D5 factory-body extraction + three handler bodies. The moved
  delivery code calls `deliverAgentMessage` from `src/lib/agents/delivery.js` — keep
  that exact call; delivery-door redesign is PAN-2228, not here.
- **WI-4 — `agent-signals.ts`** *(heartbeat, work-complete, stuck, classify-completion,
  permissions request/respond)* — move bodies; the two permissions routes keep calling
  the STAYING transport validators from the route file (the route passes the validated
  result INTO the door function).
- **WI-5 — `agent-lifecycle-ops.ts`** *(suspend, pause, unpause, untroubled, resume,
  recover, restart, restart-fresh, restart-all)* — move bodies + `createAgentStopHandler`
  (verify its users first, §2.2); repoint its test importers.
- **WI-6 — `agent-session-ops.ts`** *(handoff suggestion, handoff, reset-session,
  delivery-method, switch-model)* — move bodies; `validateAgentDeliveryMethodOrigin`
  stays behind in the route file (D3).
- **WI-7 — `agent-start.ts` + `agent-start-support.ts`** *(POST `/api/agents`)* — D4.
  Also move the seven spawn-support exports (§2.2 row 1) into `agent-start-support.ts`
  and repoint their test importers. Run the FULL suite after this seam even mid-PR —
  start-agent is pipeline machinery (TENET-10).
- **WI-8 — No-loss audit test + reconciliation.** New
  `tests/unit/dashboard/routes/agents-no-loss.test.ts` asserting the 39 method+path
  pairs (same pattern and PAN-2231-baseline handling as PAN-2148 WI-9). Repoint the two
  §2.3 introspection tests. Lower the `routes/agents.ts` baseline entry; verify FR-2's
  greps; `bash scripts/lint-circular-deps.sh --update` if PAN-2230 is live (moves change
  cycle lines; additions are audited by this issue's ref).

---

## 6. Intersecting repo rules (restated)

- **TENET-10** — full `npm test` green before merge; §2.3 introspection tests repointed
  in the same PR.
- **`lint:state-writes` single-write-surface** — must print its pass line after every
  seam; never move or duplicate a state writer; no new continue-file literals (D6).
- **Async-only server code** (`sendKeysAsync`, `execAsync`/`spawn`) — moved code
  complies; keep it so.
- **Fake timers** for any touched test with delays/retries/backoff
  (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`).
- **File-size guard** — new files <1,000; baseline lowered for `routes/agents.ts`;
  `eslint-any-allowlist.json` additions require this issue's ref in the commit message
  (audited bumps).
- **ESLint `--no-inline-config`**; **never `--no-verify`; never `git stash`**; work in
  the issue's feature workspace only.
- **Spawn paths are load-bearing:** `POST /api/agents` is how the dashboard and
  auto-spawn start every work agent — a regression here strands the whole pipeline.
  Treat WI-7 as the highest-care seam; verify against origin HEAD before merging.

---

## 7. Acceptance criteria

- **AC-1..7 (WI-1..7):** per seam — gates green; door module exists <1,000 lines;
  affected handlers ≤~40 lines; seam's repointed tests pass.
- **AC-8 (WI-8/FR-3,5):** `wc -l src/dashboard/server/routes/agents.ts` < 1,000; the
  no-loss test finds all 39 pairs; baseline lowered; FR-2 greps clean;
  `src/lib/overdeck/agents.ts` diff is empty.
- **AC-END (TENET-10):** full `npm test` 0 failed on the final rebased branch; a
  throwaway-server boot (never the live server) answers `GET /api/agents` and spawns an
  agent for a fixture issue via `POST /api/agents` identically to main.

---

## 8. Re-verify at execution

1. **PAN-2148 lands first** and may relocate `routes/issues.ts`'s
   `invalidateAgentsCache` import into a door module — re-grep
   `invalidateAgentsCache` repo-wide before WI-2.
2. **Re-run the route inventory** (`grep -n "HttpRouter.add(" src/dashboard/server/routes/agents.ts`
   + the two factory instantiations) and diff against §2.1 — classify any new route into
   a door and add it to the no-loss test.
3. **Re-run the export/importer sweeps** (`grep -n "^export "` on the file;
   `git grep -rn "from './agents.js'\|routes/agents.js" src/ tests/`).
4. **Phase 1 guards** (identical to PAN-2148 §8.4): PAN-2227 baseline audit, PAN-2231
   introspection baseline entry for the new no-loss test, PAN-2230 cycle-line updates.
5. **Confirm the monster's size and boundaries** (`awk 'NR>=<start>,NR<=<end>'` between
   the `POST '/api/agents'` add and the tmux-alive route) before choosing D4 cut points.
6. **`scripts/lint-state-writes.sh`** — re-read its rules; if a rule now names
   `routes/agents.ts` explicitly, mirror the pathspec to the door modules in the same
   commit.

## 9. Out of scope

- Delivery-door redesign (`deliverAgentMessage` semantics) — PAN-2228.
- Migrating onto `AgentsResolver`-style Effect services / endpoint retirement —
  PAN-1936 / PAN-2008.
- Any behavior change; `routes/conversations.ts` (PAN-2145, deferred until PAN-2156).
- Growing `src/lib/overdeck/agents.ts` (baselined; D2).
