# AskUserQuestion in the dashboard — pipeline, the 2026-05-31 outage, and the "Needs you" recovery

> **Scope note (PAN-1520):** AUQ is one kind in the unified pending-input
> subsystem — plan approval, permission requests, session-resume, and
> rate-limit modals share the same indicator, needs-you list, notification,
> and reopen routing. The subsystem overview lives in
> [PENDING-INPUT.md](PENDING-INPUT.md); this file remains the AUQ-specific
> debugging field guide.

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

## The marker contract (PAN-2530)

The hook's emitted `permissionDecisionReason` is a load-bearing contract with the
pending-input detector in `src/lib/agent-enrichment.ts`. It must contain **both**:

1. The literal marker `(PAN-1520)`.
2. The stable operative phrase `surfaced to the operator`.

`isAskUserQuestionHookDenyToolResult` treats a deny-style `tool_result` as still
pending if it sees **either** signal, so an old transcript that only has `PAN-1520`
keeps matching and a future copy-edit that accidentally drops one signal cannot
silently flip a deny into an answered state. The contract is enforced by
`tests/lib/auq-hook-detector-contract.test.ts`, which executes the real hook with a
synthetic PreToolUse payload and asserts the detector recognizes its output.

If you change the REASON string in `sync-sources/hooks/ask-user-question-hook`,
keep both signals or update the contract test. Dropping both breaks the
AskUserQuestion popup and the "Needs you" recovery surface.

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

## Blocked-agent surfaces beyond AskUserQuestion (PAN-1834)

Not every stall is an AUQ. A convoy sub-reviewer blocked on an interactive harness
modal (e.g. the gpt-5.5 rate-limit / model-switch dialog) never writes an AUQ to
the JSONL, so the pipeline above cannot detect it. PAN-1834 adds three additional
visibility surfaces:

### 1. Pane-detected rate-limit / model-switch modal

`detectAwaitingInputFromPaneSync` (`src/lib/agent-input-detection.ts`) recognizes
a conservative signature for the harness rate-limit dialog: the pane must contain
both a `Keep current model` option line and a `Switch to <model>` option line near
the bottom. A pane that merely mentions a rate limit in prose, or a modal that has
scrolled out of the recent window, does **not** match.

When matched, the detection returns reason `'rate_limit'`, which
`computeAgentEnrichmentPromise` promotes into the `pendingInputKinds` array as the
`'rateLimit'` kind. That kind drives the **Needs you** triangle and list with the
label *"Rate-limit modal — pick a model"*.

### 2. Active specialists are no longer suppressed

`computeAgentEnrichmentPromise` historically skipped all pending-input population
when `hasActiveSpecialist` was true. That guard was meant to silence the parked
work/plan agent while a review/test/ship specialist runs on the same issue, but
it also silenced the specialist itself. PAN-1834 narrows the guard: suppression
applies only when the agent is **not** itself the active specialist. Agents with
`role ∈ {review, test, ship}` still surface their own pending input even when
another specialist is active.

Inspect agents (`inspect-<issue>-<bead>`) are now enumerable by writing a minimal
`state.json` at spawn (`src/lib/cloister/inspect-agent.ts`). The enrichment poller
sees them the same way it sees sub-reviewers, so a blocked inspector also raises
a Needs you row. Deacon orphan-recovery ignores the `inspect-` prefix, so the new
state.json does not make inspect agents auto-resumable.

### 3. Rising-edge activity-feed + TTS notification

The enrichment poller (`src/dashboard/server/services/agent-enrichment-service.ts`)
tracks the previous `pendingInputCount` per agent. When an agent transitions from
`pendingInputCount === 0` to `pendingInputCount > 0`, the poller emits one
`activity.entry` naming the agent, its issue, and the pending kind(s), plus one
`activity.tts` utterance at priority 1 (warn). While the agent stays blocked across
subsequent polls, no further activity or TTS events fire.

This is kind-agnostic: it fires for AUQ, plan-mode approval, session-resume, and
the new rate-limit modal.

## Decisions — the canonical operator-decision surface (PAN-2765)

Everything above enumerates decisions from `agentsById`, which the store fills
from the event pipeline. Conversations never arrive that way: they are not rows
in the agents table (verified — no live `conv-*` session appears in
`listRunningAgents`), and reach the frontend over REST from
`/api/conversations/pending-input`. Until PAN-2765 only the modal read that door,
so a question from a conversation or the flywheel was invisible to "Needs you"
and to everything built on it.

`frontend/src/lib/useDecisions.ts` joins the two domains above both doors and is
now the only enumeration of what is waiting on the operator. Read it — never
`selectPendingInputSubjects` directly — or a decision will be visible in one
surface and missing from another. `usePendingInputSubjects()` is the drop-in
replacement carrying the same shape, so existing dedup and dismissed logic keeps
working. `DecisionsPanel` groups by consequence (Blocking work / Waiting) rather
than by kind, because that is what the operator triages on.

### Issue context and self-contained questions

The AUQ dialog, `DecisionsPanel`, and `SessionFeedSidebar` Needs-you rows render
`<issueId> — <issue title>` through `formatIssueRef` in
`src/dashboard/frontend/src/lib/issueLabel.ts`. The title is joined client-side
from resolver-fed store issues; these surfaces do not read a tracker or store
directly. An unbound subject omits the dialog's Issue cell instead of rendering
the old `Unknown` placeholder.

Agents receive the universal bundled rule
`sync-sources/rules/ask-user-question-self-contained.md`, reinforced by the
planning prompt, which requires each question to state the situation, the plain-
language decision, and each option's consequence. The PreToolUse hook fires
after the agent has written the question, so the question text itself must carry
the context the operator needs without the transcript.

### The `agentTurnEnded` kind

An agent that simply finished its turn is waiting on the operator just as surely
as one holding an open AUQ, but it writes no tool_use, so nothing above detects
it. `computeAgentEnrichment` adds `agentTurnEnded` when an **interactive** role
(`plan`, or any `conv-` agent) reaches runtime state `idle`. The role gate is the
whole point: a `work` agent going idle is between tasks, not asking anything, and
flagging it would make the list noise. `describePendingInput(['agentTurnEnded'])`
renders as *Answer the agent*.

### Scans are cached by mtime, never skipped

`computeAgentEnrichment` used to take a `skipJsonlScan` flag, which made it
report "no pending question" from a scan that never ran — and a blocked agent
freezes its JSONL mtime, so once latched it stayed latched. It now takes
`cachedScan` instead: the poller keeps `{ mtime, scan }` per agent and hands the
previous scan back when the mtime is unchanged. The scan result is always
present; only the re-read is skipped.

### A transcript belongs to one agent

A Claude project dir is keyed on **cwd**, so every session that ever ran in the
same cwd shares one directory. Agents whose cwd is the primary repo — the
flywheel orchestrator, conversations, `--cwd <repo>` handoffs — sit alongside
each other's transcripts there. `getAgentJsonlPath` therefore resolves the
agent's **own** pinned session id (`getLatestSessionIdSync`) and only falls back
to `getActiveSessionPath`'s freshest-wins when the agent has no transcript of its
own in that dir (codex and omp keep history elsewhere). Freshest-wins alone
attributes whichever session wrote last to whoever asks: the live flywheel was
observed reporting an operator conversation's open question as its own.

## Liveness is part of pendingness (PAN-3055)

A question is actionable only while its asking agent has a live tmux pane. Before
PAN-3055, a missing tmux server during dashboard boot produced
`tmuxAvailable:false`, but `listRunningAgents` deliberately failed open and marked
every registered agent `tmuxActive:true`. The enrichment poller then scanned
long-stopped agents, projected them as running, and announced their weeks-old
questions with TTS.

The poller now checks the runtime census before each cycle. When the census cannot
see tmux, `pollOnce` returns before it scans agents, emits domain or activity
events, speaks TTS, or mutates its enrichment caches. The fail-open remains in
`listRunningAgents` because one-off CLI processes may not see the dashboard-owned
tmux socket; those callers must not declare every registered agent dead from
missing local evidence.

Once the census is available, the poller treats removal from the census-verified
active set as a falling edge. If the removed agent had pending input, it emits a
clearing `agent.enrichment_changed` event and one info-level activity entry. It
emits no TTS because the operator cannot answer the question in place. PAN-2633's
idle-alive case remains intact: a live pane is never reaped, even when the agent
registry still carries a stop-shaped status.

Reaping removes the question from the Decisions list, but it does not erase
history. The original question and its options remain in the agent's JSONL
transcript, and the agent's terminal status records why the question expired.

## Prompt text — threading from enrichment to Decisions card (PAN-3232)

The enrichment poller captures three pieces of pending-input metadata:
- `hasPendingQuestion`: boolean, whether the agent is blocked
- `pendingQuestionPrompt`: the literal first line(s) of the pending question
- `pendingQuestionReason`: the rationale text for the block (e.g. "tool permission denied")

The **prompt text** is carried through the full render-to-display chain so the
Decisions card shows the actual question, not a generic label:

```
agent.enrichment_changed event
    │ payload.pendingQuestionPrompt, pendingQuestionReason
    ▼
agentsById[agentId] snapshot  (written by event reducer)
    ▼
selectPendingInputSubjects → PendingInputSubject (store.ts)
    └─ copies pendingQuestionPrompt and pendingQuestionReason
    ▼
useDecisions hook → Decision interface (useDecisions.ts)
    └─ preserves both fields for agent-sourced subjects
    ▼
DecisionsPanel → DecisionRow component
    └─ uses getPendingQuestionTitle (revived from pipeline-state.ts)
       to format: "Permission prompt: <first line>" or
       "Question: <first line>" depending on kind
    └─ falls back to describePendingInput(kinds) when prompt is absent
```

Conversations carry their own prompt text via the `pendingAskUserQuestion`
structure returned from the `/api/conversations/pending-input` REST endpoint,
so the threading is agent-only and leaves conversation rows unchanged.

## Sidebar badge and session-tree delta (PAN-3232)

When enrichment detects a state change (`pendingInputCount` shifts from 0 to
nonzero), the poller emits `agent.enrichment_changed`. The **session tree
sidebar** must refresh its pending-input badge within ~1s (not ~70s via the
next full JSONL scan). `mapEventToDelta` in `ws-rpc.ts` converts this event to
a `pending_input_changed` SessionTreeDelta:

```ts
// event payload carries issueId now (PAN-3232)
kind: 'pending_input_changed'
issueId: <issue>
sessionId: <agentId>
awaitingInput: <boolean>
awaitingInputPrompt: <string | undefined>
awaitingInputReason: <string | undefined>
pendingInputKinds: <['askUserQuestion'] | ['rateLimit'] | etc>
```

The `awaitingInputPrompt` and `awaitingInputReason` fields here **match the
Decisions card fields** above — the enrichment event is the single source.
The client-side `applySessionTreeDelta` **merges** (does not refetch) these
fields in place on the matched session, so the tree stays responsive while
the sidebar badge updates live. The merge is idempotent: absent fields in a
delta still clear their counterparts on the tree (so a resolved question
clears the prompt text immediately).

The `issueId` is optional on the event payload (required to issue-resolve
context). If absent, the delta is dropped (no session to match).

## Specialist nodes — review, test, ship, and reviewer (PAN-3232)

Specialist agents (review-converter, test-runner, ship-coordinator) and
reviewer sub-agents are registered in the enrichment poller the same way
work agents are. They carry `hasPendingQuestion` and `pendingInputKinds`
when blocked on a permission prompt or rate limit.

The session tree, activity route, and reviewer-tree surfaces now include the
four awaiting-input fields on specialist nodes:

- `awaitingInput: <boolean>` — whether the specialist is blocked
- `awaitingInputPrompt: <string | undefined>` — the prompt text (or undefined)
- `awaitingInputReason: <string | undefined>` — the rationale (or undefined)
- `pendingInputKinds: ReadonlyArray<string>` — the kind(s): `['permissionRequest']`, `['rateLimit']`, etc.

These fields are populated via projection-only reads against
`agentSnapshotsById` — no tmux-pane fallback is used. This is safe because
specialists are always enumerated from the poller's live registry, unlike
work agents which may be parked.

The dead `projectPendingInput` function in `read-model.ts` has been removed
(PAN-3232). That function was a bootstrap-time guard meant to detect pending
input when the enrichment poller had not yet run. But
`agentSnapshotFromOverdeck` (which populates the store at bootstrap) never
initializes pending-input fields, so the bootstrap scenario was structurally
impossible — waiting for the first enrichment poll is the only correct
initialization path.

## Gotchas for future debugging

- Dashboard runs under `pan dev`: the **frontend is Vite HMR** (source changes
  hot-reload, no rebuild), the **backend is `node dist/dashboard/server.js`**
  (Node 22). Only server changes need `npm run build` + a server-child restart.
- To restart the server child, get its PID via `ps -C node | grep
  dist/dashboard/server.js`. **Never** `pkill -f dist/dashboard/server.js` — the
  pattern matches your own shell and self-kills it (exit 144).
- `getAgentJsonlMtime` / `computeAgentEnrichment` / `getAgentJsonlPath` are all
  Effects. Anything calling them must `Effect.runPromise`.
