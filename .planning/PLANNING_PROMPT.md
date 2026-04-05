<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-470

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - Implementation plan at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-470
- **Title:** Rewrite route handlers to idiomatic Effect — eliminate runSync, try/catch, sync I/O
- **URL:** https://github.com/eltmon/panopticon-cli/issues/470

## Description
## Context

PAN-449 introduced a proper Effect service layer with idiomatic services, typed errors, and layer composition in `server.ts`. However, the **route handlers** were not genuinely rewritten — they wrap imperative code in `Effect.promise(async () => { try { ... } catch { ... } })` and call `Effect.runSync` to use services that were correctly injected via `yield*`.

This follow-up completes the refactor by rewriting routes to actually compose effects idiomatically.

## Problems to Fix

### 1. `Effect.runSync` inside async contexts (48 occurrences across 10 route files)

Services are yielded correctly, then immediately short-circuited:
```typescript
Effect.gen(function* () {
  const eventStore = yield* EventStoreService;
  return yield* Effect.promise(async () => {
    try {
      Effect.runSync(eventStore.append({ ... }));  // WRONG
      return jsonResponse({ ok: true });
    } catch (error) { ... }
  })
})
```

Should compose effects instead:
```typescript
Effect.gen(function* () {
  const eventStore = yield* EventStoreService;
  yield* eventStore.append({ ... });
  return jsonResponse({ ok: true });
})
```

**Files & counts:** issues.ts (13), agents.ts (7), workspaces.ts (7), specialists.ts (6), resources.ts (5), remote.ts (4), mission-control.ts (2), misc.ts (2), cloister.ts (1), metrics.ts (1)

### 2. Manual try/catch instead of Effect error channels (~150 blocks)

Every route repeats identical boilerplate:
```typescript
try {
  // ... work ...
  return jsonResponse(result);
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error('Error:', error);
  return jsonResponse({ error: msg }, { status: 500 });
}
```

Should use Effect error handling:
```typescript
yield* someEffect.pipe(
  Effect.map(result => jsonResponse(result)),
  Effect.catchAll(error => Effect.succeed(jsonResponse({ error: String(error) }, { status: 500 })))
)
```

Consider an `httpHandler` wrapper to centralize the error-to-response mapping so routes don't repeat it.

### 3. Sync FS calls in async handlers (335 occurrences across 9 files)

`existsSync`, `readFileSync`, `writeFileSync`, `statSync`, `readdirSync` used inside `Effect.promise(async () => { ... })`. Worst offenders: workspaces.ts (72), agents.ts (69), mission-control.ts (66), misc.ts (57).

Replace with `fs/promises` (`readFile`, `readdir`, `stat`, `access`) or Effect's FileSystem service where it makes sense.

### 4. Services yielded but unused or misused

Some handlers inject services via `yield*` then never use them, or inject them "just in case." Clean up unused injections.

### 5. Minor service-layer fixes from PAN-449 review

- **linear-client.ts**: Retry predicate uses `(err as any)?._tag === 'RateLimited'` — change to `err instanceof RateLimited`
- **github-client.ts**: `removeLabel` and `ensureLabel` call raw `fetch()` instead of the shared `ghFetch()` helper, bypassing rate-limit tracking
- **issue-lifecycle.ts**: Non-fatal `patchIssue` call uses imperative try/catch inside Effect.gen — use `Effect.try(...).pipe(Effect.ignore)` instead
- **workspace-service.ts**: `containerize` calls `createWorkspace` without checking the result
- **agent-spawner.ts**: Unnecessary `typeof normalizeAgentId === 'function'` defensive check

### 6. Test suite doesn't validate Effect behavior

All tests except `error-channel.test.ts` use `vi.mock()` / `Layer.succeed()` for everything — they pass even if the Effect code is broken. "Integration" tests are mislabeled (still fully mocked).

- Add tests that use actual `*Live` layers with only external APIs mocked
- Test error channel propagation through composed layers
- Test that `Layer.provide` ordering and composition works
- Rename current "integration" tests to "unit" and add real integration tests

## Approach

1. Create an `httpHandler` or `routeEffect` wrapper that converts Effect errors to HTTP responses, eliminating the try/catch boilerplate
2. Rewrite each route file to compose effects with `yield*` instead of `Effect.promise + runSync`
3. Replace sync FS calls with async equivalents
4. Fix the 5 minor service-layer issues
5. Add proper Effect-level tests

## Affected Files

**Routes (rewrite):**
- `src/dashboard/server/routes/issues.ts`
- `src/dashboard/server/routes/agents.ts`
- `src/dashboard/server/routes/workspaces.ts`
- `src/dashboard/server/routes/specialists.ts`
- `src/dashboard/server/routes/resources.ts`
- `src/dashboard/server/routes/remote.ts`
- `src/dashboard/server/routes/mission-control.ts`
- `src/dashboard/server/routes/misc.ts`
- `src/dashboard/server/routes/cloister.ts`
- `src/dashboard/server/routes/metrics.ts`
- `src/dashboard/server/routes/conversations.ts`
- `src/dashboard/server/routes/costs.ts`
- `src/dashboard/server/routes/settings.ts`

**Services (minor fixes):**
- `src/dashboard/server/services/linear-client.ts`
- `src/dashboard/server/services/github-client.ts`
- `src/dashboard/server/services/issue-lifecycle.ts`
- `src/dashboard/server/services/workspace-service.ts`
- `src/dashboard/server/services/agent-spawner.ts`

**Tests (rewrite/add):**
- All files in `src/dashboard/server/services/__tests__/`

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: `vBRIEFInfo` and `plan`.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/0.0.0",
    "description": "Plan for PAN-470: <issue title>"
  },
  "plan": {
    "id": "pan-470",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/470", "label": "PAN-470", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-470"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

**CRITICAL vBRIEF rules:**
- The file MUST have `vBRIEFInfo` and `plan` as the ONLY top-level keys
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-470")
- `plan.uid` MUST be a freshly generated UUID v4
- Do NOT use `issue`, `issueId`, or `issue_id` — use `plan.id`
- `items[].status` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be `subItems` with `metadata.kind: "acceptance_criterion"`
- `metadata.difficulty` and `metadata.issueLabel` are Panopticon extensions to the vBRIEF spec
- Edge types: `blocks` (hard dependency), `informs` (soft), `invalidates`, `suggests`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
