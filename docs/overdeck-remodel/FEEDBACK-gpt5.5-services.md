# Overdeck service-tier review (gpt5.5)

## Executive summary

The service-tier direction is mostly sound: the resolver/writer/controller split matches the installed Effect v4-beta shape, and the cross-domain seams are better than the old schema/end-state draft. I would not ship it yet. I found four no-loss/boundary defects that need correction before this can be called ready: Cost drops a real `pan cost` CLI family, Issues narrows the live `readyForMerge` predicate and loses `testStatus=skipped`, Transcripts assigns cache writes to a service explicitly called a resolver, and permission prompts are relocated to a module name rather than a modeled service/controller. The strongest objection is that the tier still relies on too many "residue" labels for live process surfaces; residue is acceptable only when it has an explicit service/controller home and a no-loss test.

## Prioritized findings

### P0 - Cost doc falsely says `pan cost` does not exist, dropping an entire CLI surface

**Claim.** `services/cost.md` says there is no `pan cost` subcommand, so no Cost service member is needed for CLI parity. That is false in the live CLI.

**Evidence.**

- `docs/overdeck-remodel/services/cost.md:182-193` says "**There is no `pan cost` subcommand**" and maps nothing to Cost services.
- `src/cli/index.ts:1341-1342` registers `program.addCommand(createCostCommand())`.
- `src/cli/commands/cost.ts:103-105` creates the `cost` command.
- The live command includes read/report verbs: `today` (`src/cli/commands/cost.ts:107-158`), `week` (`src/cli/commands/cost.ts:160-197`), `month` (`src/cli/commands/cost.ts:199-244`), `report` (`src/cli/commands/cost.ts:246-267`), and `issue <issueId>` (`src/cli/commands/cost.ts:269-310`).
- It also includes budget writes/reads/deletes: `budget create/list/check/delete` (`src/cli/commands/cost.ts:312-445`) and WAL sync (`src/cli/commands/cost.ts:447-451`).

**Fix.** Replace Cost §1B with a real no-loss mapping:

- `pan cost today/week/month/report/issue` -> `CostResolver.summary`, `byDay`, `issueDetail`, and report formatting.
- `pan cost sync` -> `CostWriter.reconcile({ source: "wal" })`.
- Either preserve `pan cost budget *` behind a real Budget/Settings home, or explicitly delete the feature with a CLI-removal decision. It cannot be justified as "zero live callers" while it is exposed as a user command.

### P0 - `IssuesResolver.readyForMerge` loses the current `testStatus=skipped` path

**Claim.** The proposed Issues derived predicate is not behavior-preserving. It requires `testOutcome === "passed"`, but current code treats skipped tests as ready when review passed and verification did not fail.

**Evidence.**

- The service doc acknowledges `testOutcome` can be `skipped` (`docs/overdeck-remodel/services/issues.md:31-33`).
- The proposed predicate requires `i.testOutcome === "passed"` (`docs/overdeck-remodel/services/issues.md:429-432`).
- Live `setReviewStatus` computes readiness with `(merged.testStatus === 'passed' || merged.testStatus === 'skipped')` (`src/lib/review-status.ts:282-286`).
- The repair sweep uses the same skipped-test rule (`src/lib/review-status.ts:517-526`).
- `pan review pending --ready` lists rows by the stored `readyForMerge` flag (`src/cli/commands/pending.ts:26-32`), so this predicate directly affects a live CLI surface registered at `src/cli/index.ts:325-330`.

**Fix.** Change the service predicate to:

```ts
i.reviewOutcome === "passed"
&& (i.testOutcome === "passed" || i.testOutcome === "skipped")
&& i.verificationOutcome !== "failed"
```

Also add a no-loss test that constructs review passed + test skipped + verification pending/passed and proves `IssuesResolver.list({ readyForMerge: true })` includes it.

### P0 - `TranscriptsResolver` is assigned write/cache-maintenance verbs, violating the two-door rule

**Claim.** `services/conversations.md` calls `TranscriptsResolver` read-only, then maps `scan`, `enrich`, and `embed` writes to that resolver. This breaks the stated architecture convention that the resolver is the read door and the writer is the mutator.

**Evidence.**

- The glossary says `TranscriptsResolver` is a shared **read-only** service (`docs/overdeck-remodel/services/conversations.md:60-64`).
- The same doc says discovered-session rebuild/enrich/embed writes are "cache-maintenance that the resolver owns" (`docs/overdeck-remodel/services/conversations.md:200-206`).
- It maps `POST /api/discovered-sessions/scan` to `TranscriptsResolver.rebuild` (`docs/overdeck-remodel/services/conversations.md:218`), `POST /api/discovered-sessions/enrich` and `/:id/enrich` to `TranscriptsResolver.enrich` (`docs/overdeck-remodel/services/conversations.md:219-220`), and `POST /api/discovered-sessions/embed` to `TranscriptsResolver.embed` (`docs/overdeck-remodel/services/conversations.md:221`).
- The live endpoints are real write/maintenance surfaces: scan (`src/dashboard/server/routes/discovered-sessions.ts:478-565`), enrich (`src/dashboard/server/routes/discovered-sessions.ts:398-474` and `569-650`), and embed (`src/dashboard/server/routes/discovered-sessions.ts:655-699`).
- The architecture convention says the read door is the only reader and the write door is the only mutator (`docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:17-19`).

**Fix.** Introduce a `TranscriptsWriter` or `TranscriptIndexWriter` for pure-cache maintenance: `rebuild`, `enrich`, `embed`, and any checkpoint/index invalidation. Keep `TranscriptsResolver` to `list/get/stats/search/parse/resolveFile/watch`. If the team wants "no writer because no durable truth", rename the mutating service so it is not a resolver; the controller's `R` still needs to distinguish read-only from mutating capabilities.

### P0 - Agent permission prompts are relocated to an unmodeled service, and the doc cites stale endpoint paths

**Claim.** Permission prompts are a live write/read-model surface, but the Agents doc relocates them to "agent-permissions" without defining an API tier home. It also names paths that do not match the real routes.

**Evidence.**

- The Agents doc maps `POST /internal/agents/:id/permission-request` and `POST /api/agents/:id/permission-response` to `agent-permissions` (`docs/overdeck-remodel/services/agents.md:205-206`) and later calls this residue (`docs/overdeck-remodel/services/agents.md:378-380`).
- The actual endpoints are `POST /api/internal/agents/:id/permissions/request` (`src/dashboard/server/routes/agents.ts:1367-1370`) and `POST /api/agents/:id/permissions/:requestId/respond` (`src/dashboard/server/routes/agents.ts:1452-1455`).
- The request path appends `agent.permission_requested` and `agent.waiting_started` events (`src/dashboard/server/routes/agents.ts:1415-1438`).
- The response path persists resolution events and delivers the decision (`src/dashboard/server/routes/agents.ts:1476-1506`), using helper logic that can fail separately on persistence vs delivery (`src/dashboard/server/routes/agent-permissions.ts:82-143`).
- The route layer registers both endpoints as part of the Agents HTTP surface (`src/dashboard/server/routes/agents.ts:3855-3872`).

**Fix.** Add an explicit service/API home, not a module-name relocation. Options:

- `AgentPermissionsWriter.request/resolve` + `AgentPermissionsResolver.pending`, backed by EventBus/read-model plus delivery dependency; or
- fold it into a documented delivery/runtime service if that service is intentionally the owner.

Either way, update the no-loss table with the real paths and add tests for duplicate request, wrong-agent response, persistence failure, and delivery failure, because the current helper distinguishes all four.

### P1 - Observability under-specifies replay retention and gap semantics

**Claim.** The Observability doc says `replayEvents(fromSequence)` is only called with `snapshot.sequence`, but the API contract accepts an arbitrary `fromSequence`. If `events` is disposable and retention is tiered, the service needs an explicit "gap too old, refresh snapshot" behavior.

**Evidence.**

- `services/observability.md` says replay is "Called only with `snapshot.sequence`, never from 0" (`docs/overdeck-remodel/services/observability.md:27-30`).
- The RPC contract exposes `pan.replayEvents` with a caller-provided `fromSequence` (`packages/contracts/src/rpc.ts:255-259`).
- The live handler passes the caller's value straight to `eventStore.readFrom(input.fromSequence)` (`src/dashboard/server/ws-rpc.ts:661-664`).
- The same doc says retention will be periodic/tiered and replaces the current unbounded behavior (`docs/overdeck-remodel/services/observability.md:39-41`).

**Fix.** Specify the replay contract: either guarantee retention back to every active client's last snapshot sequence, or return a typed `ReplayGap`/`SnapshotRequired` error when `fromSequence` is older than retained events. The client then refreshes via `getSnapshot`. Add this to the RPC schema before trimming events.

### P1 - Drizzle is still a cutover dependency, not a verified installed API

**Claim.** The Effect v4 conventions are grounded, but the Drizzle half of the service tier is still a planned dependency. That is fine as a TODO, but it must stay a cutover gate.

**Evidence.**

- The conventions correctly say `Context.Service` exists (`docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:40-44`), and the installed package confirms the class-style form (`node_modules/effect/dist/Context.d.ts:225-274`).
- `Effect.Service` is not exported in the installed Effect typings (`node_modules/effect/dist/Effect.d.ts` has no `export declare const Service`; grep returned no match).
- The installed HttpApiEndpoint constructors support the documented `{ params, query, payload, success, error }` object shape (`node_modules/effect/dist/unstable/httpapi/HttpApiEndpoint.d.ts:548-583`).
- The conventions say `drizzle-orm` and `drizzle-kit` are not yet dependencies and require a first-step compile smoke test (`docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:98-109`).
- Root `package.json` currently has `effect` but no `drizzle-orm`, `drizzle-kit`, or `better-sqlite3` dependency (`package.json:109-141`, `package.json:142-160`).

**Fix.** Keep the Drizzle note as a hard acceptance gate: add the dependencies, run a Node 22 smoke test for `sqliteTable`, `.references()`, partial indexes, FK enforcement, and one resolver/writer transaction before implementing domain code.

### P1 - "Residue" needs a uniform service boundary, not per-doc ad hoc labels

**Claim.** Agents, Conversations, and Control/Settings all correctly identify live process work that is not a cache write, but they do not converge on one API-tier pattern. That leaves handlers with direct access to delivery/runtime helpers even though the brief asks for service-level boundaries.

**Evidence.**

- Agents calls delivery a "separate delivery service" outside the read/write doors (`docs/overdeck-remodel/services/agents.md:370-374`).
- Conversations introduces `ConversationRuntime` as a sibling service for tmux spawn/stop/resume/restart, message delivery, approval keystrokes, attachments, and pending-input scans (`docs/overdeck-remodel/services/conversations.md:70-79`, `181-189`).
- Control/Settings maps Cloister runtime operations to a "runtime service (PROC)" and SettingsWriter delegation (`docs/overdeck-remodel/services/control-settings.md:181-199`, `219-225`).
- The live implementation proves this is not theoretical: conversation message delivery calls `deliverAgentMessage` from handlers (`src/dashboard/server/routes/conversations.ts:100`, `3259-3311`), and the shared primitive lives in `src/lib/agents.ts:1595`.

**Fix.** Write a short shared convention for non-data process services: `DeliveryService`, `ConversationRuntime`, `CloisterRuntime`, etc. Controllers may depend on those services, but not directly on `src/lib/agents.ts` helpers, tmux helpers, or event-store helpers. Then update every `RESIDUE` row to a concrete service method and add it to the handler `R`.

### P2 - Settings route counts are confusing and should be normalized before implementation

**Claim.** `control-settings.md` labels `settings.ts` as 16 endpoints while enumerating 20 and then explains the discrepancy. That is acceptable for a review doc, but brittle as an implementation source.

**Evidence.**

- The section header says `settings.ts (16)` (`docs/overdeck-remodel/services/control-settings.md:135`).
- The table enumerates 20 routes (`docs/overdeck-remodel/services/control-settings.md:145-166`).
- The note explains the count mismatch (`docs/overdeck-remodel/services/control-settings.md:168-172`).

**Fix.** Change the heading to "settings.ts (20 route objects; 16 API-SURFACE-counted)" or split OpenRouter/conversation-search into their own subsections. This prevents a later implementer from treating four rows as accidental surplus.

## What's good / keep

- Keep the cross-domain split between auto-merge policy (`issue_policy`, Settings) and auto-merge schedule (`pending_auto_merges`, Merge). The Merge doc names the two facts cleanly (`docs/overdeck-remodel/services/merge.md:64-89`), and that is the right boundary.
- Keep the Conversations exception that DB metadata is currently source-of-truth until the PAN-1937 export exists. The doc states the durability inversion and loss risk directly (`docs/overdeck-remodel/services/conversations.md:91-115`).
- Keep the Memory design's explicit second store boundary. Modeling `memory-search.db` as `MemorySearch` instead of pretending it is the shared `Db` is the right abstraction (`docs/overdeck-remodel/services/memory.md:89-105`).
- Keep the Effect v4 direction: `Context.Service` plus HttpApiGroup matches the installed Effect beta, and the controller `R = Resolver | Writer` pattern is the right way to make the two-door rule enforceable.
