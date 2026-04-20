# PAN-540: Remove convoy abstraction, inline parallel review into review-agent

## Problem

The `convoy` abstraction was designed for two use cases:
1. A multi-issue fleet runner (`pan convoy create MIN-10 MIN-11 …`) — **never built**
2. A parallel code-review orchestrator (3 reviewers + synthesis) — **the only real use**

Everything in `src/lib/convoy.ts`, `src/lib/convoy-templates.ts`, the `src/cli/commands/convoy/` tree, the `/api/convoys/*` routes, the `ConvoyPanel` + `useConvoys` hook, the "Convoys" nav/route, and the `convoy:*` work-type namespace exists solely to run a fixed set of 4 agents in a fixed order. That is pure overhead — `review-agent.ts` already knows which reviewers it needs; it doesn't need a generic template registry to tell it.

## Proposal

Inline the parallel-review flow directly into `src/lib/cloister/review-agent.ts`, delete the convoy machinery, rename the `convoy:*` work types to `review:*`, and introduce a user-configurable `specialists.review_agents[]` list in `config.yaml` so users can add/swap reviewers without touching code.

**Sequencing rule:** refactor first, delete second. Every bead must leave the tree green — review-agent is inlined and stops importing from convoy.ts *before* any convoy file is deleted.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Config shape | `review_agents: [{name, model, focus[], enabled}]` array | Matches PRD; user-extensible. Absent ⇒ default 3 (correctness/security/performance). |
| `requirements-reviewer` | Rename to `review:requirements` | Keep 5th built-in reviewer focus, no behavior change. |
| Migration of user model overrides | Auto-migrate `convoy:*` → `review:*` on settings load | One-time silent rename, no user action. |
| Dashboard `/convoys` UI | Remove entirely | Review progress is already visible through normal agent/workspace views. |
| Output directory | Rename `.pan/convoy/<id>/` → `.pan/review/<id>/` | Consistent with removing the convoy concept. |
| Landing order | Refactor first, then delete | Each bead leaves tree green and is independently mergeable. |

## Architecture — new parallel-review runner

Inside `review-agent.ts`, replace `startConvoy('code-review', ctx)` + `waitForConvoy(id)` + `parseConvoySynthesis(dir)` with a local helper, roughly:

```ts
async function runParallelReview(ctx: ReviewContext, agents: ReviewAgentConfig[]): Promise<ReviewResult> {
  const reviewId = `review-${ctx.issueId}-${Date.now()}`;
  const outputDir = path.join(ctx.projectPath, '.pan/review', reviewId);
  await fs.mkdir(outputDir, { recursive: true });

  // 1. spawn N reviewer tmux sessions in parallel (one per enabled agent)
  const sessions = await Promise.all(
    agents.filter(a => a.enabled !== false).map(a => spawnReviewer(a, ctx, outputDir))
  );

  // 2. poll for completion of all N (same polling cadence as waitForConvoy)
  await waitForAllSessions(sessions, REVIEW_TIMEOUT_MS);

  // 3. run synthesis agent with outputs from N reviewers
  await runSynthesis(ctx, outputDir, agents.map(a => a.name));

  // 4. parse synthesis.md markers (REVIEW_RESULT / SECURITY_ISSUES / PERFORMANCE_ISSUES / NOTES)
  return parseReviewSynthesis(outputDir);
}
```

Model IDs for each reviewer come from the `review:<name>` work type (via `smart-model-selector`), with per-agent override from `review_agents[].model` taking precedence.

### Synthesis rules
- If **any** reviewer says `CHANGES_REQUESTED` → overall `CHANGES_REQUESTED`
- Security issues from any reviewer are always surfaced
- Duplicate findings (same file + same concern) collapsed
- Each finding attributed to the reviewer that found it

## Removal inventory (from exploration)

**Delete:**
- `src/lib/convoy.ts` (~514 LOC)
- `src/lib/convoy-templates.ts` (~258 LOC)
- `src/cli/commands/convoy/{index,start,stop,list,status}.ts`
- `src/agents/convoy/*.yaml` templates
- `tests/lib/convoy.test.ts`
- `src/dashboard/frontend/src/components/ConvoyPanel.tsx`
- `src/dashboard/frontend/src/hooks/useConvoys.ts`

**Modify:**
- `src/lib/cloister/review-agent.ts` — inline runner (bead 1)
- `src/cli/index.ts` — drop `registerConvoyCommands`
- `src/dashboard/server/routes/metrics.ts` — drop 5 convoy routes
- `src/dashboard/frontend/src/App.tsx` — drop `/convoys` route
- `src/dashboard/frontend/src/components/Sidebar.tsx` — drop Convoys nav item
- `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx` — rename card section
- `src/dashboard/frontend/src/components/Settings/types.ts` — update `WorkTypeId` union
- `src/lib/work-types.ts` — rename 5 entries
- `src/lib/smart-model-selector.ts` — rename keys
- `src/lib/settings-api.ts` — rename + auto-migrate old keys
- `src/lib/cloister/config.ts` — add `SpecialistsConfig.review_agents?: ReviewAgentConfig[]`
- `docs/CONFIGURATION.md` — update all examples

## Out of scope

- The fleet-runner use case (never built, not revived)
- Rebuilding a "parallel review progress" dashboard panel (deferred)
- Changes to the `agents/code-review-*.md` prompt templates
- Changes to `inspect`/`test`/`uat`/`merge` specialists

## Quality gates (per bead, enforced by pipeline)

- `npm run typecheck`
- `npm run lint`
- `npm test`
