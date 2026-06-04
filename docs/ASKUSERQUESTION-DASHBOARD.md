# AskUserQuestion in the dashboard — pipeline, the 2026-05-31 outage, and the "Needs you" recovery

This documents how an agent's **AskUserQuestion** (AUQ) becomes a clickable
dialog in the dashboard, the two root-cause bugs that silently broke it, and the
"Needs you" recovery surface added so a dismissed question is never stranded.

It is written as a debugging field guide: if the Q&A popup "doesn't appear", read
this before touching anything.

## TL;DR

- The popup is driven **entirely by the Zustand store**, not `/api/agents`.
- A **PreToolUse hook deny** is what makes a native AUQ detectable at all.
- Two bugs broke it: (1) the tmux-liveness check ignored `planning-`/`conv-`/
  `strike-` sessions, and (2) the enrichment poller `await`ed an **Effect**
  instead of running it, nulling every enrichment field for every agent.
- ESC on the dialog used to strand the question; the **"Needs you"** section in
  the activity feeds now re-opens it on click.

## The pipeline

```
agent calls AskUserQuestion
        │
   PreToolUse hook  (sync-sources/hooks/ask-user-question-hook, "PAN-1520")
   └─ DENIES it → writes a tool_result containing the literal "PAN-1520"
        │           (a native, un-denied AUQ does NOT write its tool_use to the
        │            JSONL until answered → it would be undetectable)
        ▼
   Claude JSONL  (~/.claude/projects/<encoded-workspace>/<session>.jsonl)
        │
   enrichment poller  (src/dashboard/server/services/agent-enrichment-service.ts, ~10s)
   ├─ listRunningAgents() → keep only agents with a live tmux session
   ├─ computeAgentEnrichment(agentId)  (src/lib/agent-enrichment.ts)
   │    └─ scanPendingInputsPromise() reads the tail of the JSONL, pairs the
   │       AskUserQuestion tool_use with its deny tool_result, and (unless a
   │       later user-text turn cleared it) returns it as pending
   └─ emits agent.enrichment_changed { pendingAskUserQuestion }
        ▼
   read-model reducer  (packages/contracts/src/event-reducers.ts)
   └─ writes pendingAskUserQuestion onto agentsById[id]
        ▼
   selectAgentsWithPendingAskUserQuestion  (frontend/src/lib/store.ts)
        ▼
   App.tsx  → builds subjects → <AskUserQuestionDialog>
```

### `/api/agents` is a red herring

The dialog never reads `/api/agents`. That REST endpoint hardcodes
`hasLiveTmuxSession=false` and feeds unrelated UI (the stopped-agents banner,
spawn forms). A planning session being absent from `/api/agents` says nothing
about the popup. Debug the **store**, not that endpoint.

### Why the hook deny is load-bearing

A native AUQ renders its choice menu in the agent's TUI but does **not** append
its `tool_use` to the JSONL until it is answered — so it cannot be detected from
the JSONL. The PAN-1520 hook converts the AUQ into a *visible, detectable* state
by denying it: the deny writes a `tool_result` whose text contains `PAN-1520`,
and `isAskUserQuestionHookDenyToolResult` keys on that exact marker. **If you
reword the hook's reason, keep the `(PAN-1520)` string** or detection breaks and
the popup silently stops appearing. The operator's next plain-text answer turn
clears the "denied-awaiting-user" state.

## The two root-cause bugs (fixed 2026-05-31, commit `360edc268`)

### 1. tmux liveness ignored non-`agent-` sessions

`listRunningAgents()` (`src/lib/agents.ts`) computed `tmuxActive` against
`getAgentSessions()`, which returns **only `agent-*`** sessions:

```ts
export const getAgentSessions = () =>
  listSessions().pipe(Effect.map(s => s.filter(x => x.name.startsWith('agent-'))))
```

So `planning-`, `conv-`, and `strike-` sessions always read `tmuxActive: false`.
The enrichment poller scans only `runningAgents.filter(a => a.tmuxActive)`, so
**planning agents were never scanned** → never got `pendingAskUserQuestion` →
no popup for the most common interactive case (a planning agent asking the
operator a question).

**Fix:** `listRunningAgents` now matches liveness against the **unfiltered**
`listSessions()`. It already enumerates every agent state dir regardless of role
prefix, so liveness must consider all sessions, not just `agent-*`.

### 2. the poller `await`ed an Effect instead of running it

`computeAgentEnrichment()` and `getAgentJsonlMtime()` are **Effect-returning**
functions. The poller did:

```ts
const enrichment = await computeAgentEnrichment(agentId, ...)   // BUG
```

`await` on a non-thenable Effect resolves to **the Effect object**, not the
computed value. So `enrichment.hasPendingQuestion` was `undefined`,
`enrichment.pendingAskUserQuestion` was `undefined`, etc. — for **every agent**.
The reducer coerced `hasPendingQuestion ?? false` and dropped
`pendingAskUserQuestion`, so no agent ever surfaced a question.

The diagnostic tell: logging `currentMtime` printed
`{ _id: 'Effect', op: 'Async' }` instead of a number.

**Fix:** wrap both calls in `Effect.runPromise(...)`.

This bug had been latent since `computeAgentEnrichment` was migrated to Effect;
the poller's `await` was never updated. Note `enrichmentChanged(undefined, x)`
returns `true`, so the first poll always emits — meaning a stuck `false`/`undefined`
could only come from the value never resolving, which pointed straight at the
un-run Effect.

## The "Needs you" recovery (commits `28ed5edc3`, `13ed4f39e`)

Pressing **ESC** on the dialog adds the subject to App's
`dismissedAskUserQuestionAgentIds`, which is only re-allowed once the AUQ clears
server-side. A still-pending, ESC-dismissed question therefore became
**unreachable** — the operator had no way to get the dialog back.

Added a pinned **"Needs you"** section to
`frontend/src/components/sessionFeed/SessionFeedSidebar.tsx`, which renders in
**both** the home **Activity Feed** and the Command Deck **Project Activity**
(the same component). It lists every agent with an outstanding AskUserQuestion
(scoped to the feed's `issueIds`, or all when `unscoped`) and persists regardless
of the dismissed flag. Clicking an entry calls
`useAskUserQuestionUiStore.requestReopen(subjectId)` — a tiny sibling Zustand
store (`frontend/src/lib/askUserQuestionUiStore.ts`, kept out of the
event-sourced store like `panesStore`). App.tsx watches the reopen nonce and,
when it changes, **un-dismisses** the subject and **focuses** it so
`currentAskUserQuestionSubject` resolves to that exact question (rather than the
default oldest-first) and the dialog re-opens.

### Verifying the popup locally without waiting for a real AUQ

Inject a synthetic pending AUQ into the store from the browser console (the
dialog auto-opens; the "Needs you" entry appears; ESC dismisses; clicking the
entry — `button[title="Re-open this question"]` — re-opens it):

```js
const store = window.useDashboardStore
store.setState(p => ({ agentsById: { ...p.agentsById, 'test-auq-agent': {
  id: 'test-auq-agent', issueId: 'ZZTESTAUQ', status: 'running', role: 'plan',
  pendingAskUserQuestion: { toolUseId: 't1', askedAt: new Date().toISOString(),
    questions: [{ question: 'verify?', header: 'Q', multiSelect: false,
      options: [{label:'Yes'},{label:'No'}] }] } } } }))
// cleanup: delete agentsById['test-auq-agent'] or reload
```

Match the **`button[title="Re-open this question"]`** specifically — a loose
text match also hits the phantom issue card the fake agent spawns and will
navigate to `/board` instead.

## Gotchas for future debugging

- Dashboard runs under `pan dev`: the **frontend is Vite HMR** (source changes
  hot-reload, no rebuild), the **backend is `node dist/dashboard/server.js`**
  (Node 22). Only server changes need `npm run build` + a server-child restart.
- To restart the server child, get its PID via `ps -C node | grep
  dist/dashboard/server.js`. **Never** `pkill -f dist/dashboard/server.js` — the
  pattern matches your own shell and self-kills it (exit 144).
- `getAgentJsonlMtime` / `computeAgentEnrichment` / `getAgentJsonlPath` are all
  Effects. Anything calling them must `Effect.runPromise`.
