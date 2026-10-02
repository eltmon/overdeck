# Linear MCP Auth Intervention (PAN-2997)

When an agent's Linear MCP OAuth session is missing or expired, the agent can
only print an authorization URL into its own transcript and block — easy to
miss. Overdeck surfaces that state as **one global dashboard intervention**: a
top banner listing every blocked agent, a one-click **Connect Linear** action,
and fallback completion paths, followed by an automatic wake of each blocked agent once authentication
is healthy again.

Related: [CODEX-AUTH.md](./CODEX-AUTH.md) — the same top-banner treatment for
GPT/Codex OAuth failures.

## Detection: the hook contract

`sync-sources/hooks/linear-mcp-auth-hook` is a Claude Code hook registered with
matcher `mcp__linear__.*` for **both** `PostToolUse` and `PostToolUseFailure`
(see `HOOK_SCRIPT_NAMES` and `OVERDECK_HOOK_REGISTRATIONS` in
`src/lib/claude-hooks-registration.ts`). This dual registration is load-bearing:
`PostToolUse` fires only after a tool call *succeeds*, so a failed MCP call —
the motivating OAuth-expired case — never reaches a `PostToolUse`-only hook.
Failures arrive as `PostToolUseFailure` with a top-level `error` field and no
`tool_response`. The hook never breaks Claude Code — every failure mode exits
0 silently.

The hook emits heartbeat events via `pan_emit_event` (see
`sync-sources/hooks/pan-hook-lib.sh`). Its emitted `kind` strings are a
load-bearing contract with the ingestion layer — a copy-edit that renames them
silently breaks detection:

- `linear_mcp_auth_required` — emitted when:
  - `mcp__linear__authenticate` returns; the first
    `https://linear.app/oauth/authorize…` URL in the tool response is extracted
    into `authUrl` (`null` when extraction fails);
  - a `PostToolUseFailure` event's `error` text matches the auth classifier
    (`requires authentication|not authenticated|unauthorized`, or `401` with a
    non-identifier boundary so `MIN-401`-style data can never match); or
  - a successful `PostToolUse` payload is error-shaped (`isError: true` or an
    `error` member) AND matches the same classifier. Ordinary successful
    result data — issue identifiers, titles mentioning 401s or "unauthorized"
    — is never auth-classified: it clears a pending intervention instead of
    raising a false one.
  - Each required emission touches the marker file
    `${OVERDECK_HOME}/agents/<agentId>/linear-mcp-auth-pending`.
- `linear_mcp_auth_healthy` — emitted only when a `mcp__linear__*` response is
  clean **and** the marker file exists; the marker is deleted on emit. A clean
  response with no marker emits nothing (no event spam on healthy agents).

The server-side ingestion (`bodyToEvent`, linear-mcp-heartbeat-ingestion) maps
these heartbeat kinds onto the domain events below, enriching each with the
agent's `issueId`.

## Domain events and payloads

Canonical definitions live in `src/lib/linear-mcp-auth.ts`
(`LinearMcpAuthEventInput`). Four event types:

| Type | Payload | Emitted by |
| --- | --- | --- |
| `linear_mcp_auth.required` | `{ agentId, issueId, authUrl, expiresAt }` | Hook heartbeat ingestion |
| `linear_mcp_auth.healthy` | `{ agentId, issueId, source: 'hook' \| 'operator' }` | Hook heartbeat ingestion, or the operator via `POST /api/linear-mcp-auth/complete` |
| `linear_mcp_auth.notified` | `{ agentId, issueId, outcome: 'delivered' \| 'queued' \| 'failed', lifecycleId }` | The wake pass, after the outbox records the delivery outcome. (The decodable `delivering` literal is a legacy value from the pre-outbox iteration and is ignored by the fold.) |
| `linear_mcp_auth.callback_relayed` | `{ agentId, issueId }` | `POST /api/linear-mcp-auth/callback`, after relaying a callback URL |

## Lifecycle fold semantics

`foldLinearMcpAuthEvents` in `src/lib/linear-mcp-auth.ts` reduces the event log
into one **open lifecycle** plus the last completed one:

- **One open lifecycle.** The first `required` event opens it; every later
  `required` dedups into it — agents are keyed by `agentId`, so repeated auth
  failures from the same agent update its row instead of minting a new OAuth
  request, and additional agents join the same intervention. Each lifecycle
  gets a durable correlation id (`seq-<n>`, the sequence of the `required`
  event that opened it).
- **Correlated notifications.** `notified` events carry the `lifecycleId` of
  the lifecycle whose wake pass produced them, and the fold applies a
  notification only to that lifecycle. Without this, a delayed delivery record
  from lifecycle A could be stamped onto a newer lifecycle B for the same
  agent, permanently suppressing B's wake. (Records written before this
  correlation existed carry no `lifecycleId` and apply to the current
  lifecycle as before.)
- **authUrl ownership.** The most recent `required` event carrying a non-null
  `authUrl` owns the intervention's authorization URL (`authUrlAgentId`). The
  URL is the agent-generated OAuth link the operator opens.
- **Expiry TTL.** URLs expire after `LINEAR_MCP_AUTH_URL_TTL_MS` (30 minutes)
  from declaration unless the event carries its own `expiresAt`. The
  projection reports `status: 'expired'` once the TTL passes. An expired link
  is regenerated on demand by **Connect Linear** (a refresh request, see
  "Connect and verify routes"), or whenever a blocked agent emits a fresh
  `required` with a new URL.
- **Close.** Any `linear_mcp_auth.healthy` event closes the open lifecycle
  (it becomes `lastCompleted`, and the projection returns to `status:
  'none'`). `callback_relayed` is record-keeping only.
- **Bounded complete reads.** The fold never queries event types with the
  store's per-type cap — repeated failures would push earlier blocked agents
  out of a 100-event window — and it never runs a generic full-history read
  either: the projection is maintained incrementally. Each read fetches only
  auth-typed events newer than the covered sequence through
  `EventStore.queryByTypesSince`, an indexed SQL query that applies the type
  predicate and sequence bound in the database, so the banner's 5–30s polling
  path typically reads zero rows and never materializes unrelated retained
  history. If retention compaction or a purge leaves the store behind the
  covered sequence, the projection restarts from scratch.
- **Projection.** `resolveLinearMcpAuthIntervention()` serves `GET
  /api/linear-mcp-auth` with `{ status, authUrl, authUrlAgentId,
  authUrlExpiresAt, declaredAt, blockedAgents[] }`; the route enriches each
  blocked agent with projection-only fields that are never persisted in
  events:
  - `issueUrl` — its canonical tracker URL from the issues read door (Linear
    web URL, GitHub html_url), so the banner can link every issue;
  - `conversationUrl` — for `conv-*` agents, `/conv/<rowid>`. The agent id is
    the conversation's tmux session, so it resolves through
    `getConversationByTmuxSession`, falling back to the bare DB name
    (`agentId` without `conv-`) so an archived conversation still links;
  - `conversationTitle` — that conversation's title (`null` otherwise).

  Because the fold reads the durable event store, banner state
  survives dashboard restarts.

## Banner states

`src/dashboard/frontend/src/components/LinearMcpAuthBanner.tsx` is mounted in
`AppChrome.tsx` under `CodexAuthBanner`. It reads everything from
`src/dashboard/frontend/src/hooks/useLinearConnectFlow.ts`, which owns the
status query (`useLinearMcpAuthStatus`): it polls every 1 s while a Connect
Linear flow is in progress, else 5 s while an intervention is open and 30 s
when idle.

- **none** — banner hidden.
- **active or expired** — "Linear authentication required" header with one
  **Connect Linear** button (disabled while a flow is in progress). When the
  browser blocked the popup, an "Open Linear authorization" anchor to the
  link replaces the button.
- **Progress line**, by flow phase: "Opening Linear…", "Getting a fresh
  link…", "Approve access in the Linear tab, then come back here." (with a
  **Check now** button), "Checking Linear access…". With no flow running and
  `status: 'expired'`: "The last authorization link expired — Connect Linear
  gets a fresh one." A verify that does not connect within 60 s shows "Linear
  still isn't connected. Finish approving in the Linear tab, then click Check
  now."
- **Blocked-agent rows** — label `conversationTitle ?? issueId ?? agentId`;
  link `conversationUrl`, else the dashboard issue view `/issues/<issueId>`,
  else plain text. The raw `agentId` is the link's `title`. An issue with a
  tracker URL also gets an external-link icon ("Open <issueId> in tracker").
- **Fallback disclosure** — "Signed in from a different device? Paste the
  callback URL" holds the callback field, its submit button, and "Already
  authorized another way? Mark completed". It starts open only when the
  dashboard host is not a **loopback host** (`isLoopbackHost` in
  `src/dashboard/frontend/src/lib/loopbackHost.ts`: `localhost`, any
  `*.localhost` such as `overdeck.localhost`, `127.0.0.0/8`, `::1`/`[::1]`).

## Operator completion flows

1. **Connect Linear (same machine).** The click handler opens a blank tab
   synchronously (`window.open('about:blank', '_blank')`; a `window.open`
   after an `await` is popup-blocked), then POSTs
   `/api/linear-mcp-auth/connect`. The server either returns the usable link
   or asks a blocked agent for a fresh one (open-or-refresh, below); the
   banner polls until a link different from the reported `previousAuthUrl`
   arrives (90 s timeout → the tab closes and an error toast says "No fresh
   Linear link yet — open a blocked conversation to check on it."). Before
   navigating, the banner sets `tab.opener = null`. The operator approves in
   that tab; Linear redirects to the owner's localhost callback listener and
   Claude Code stores the token. That redirect fires no hook, so nothing
   would close the lifecycle on its own. On a loopback dashboard host, the
   first window `focus` or `visibilitychange` to visible at least 2 s after
   navigation therefore POSTs `/api/linear-mcp-auth/verify`, which asks the
   owner to make one Linear read; its hook emits `healthy`, the lifecycle
   closes, and the wake pass resumes every blocked agent. **Check now** sends
   the same request by hand. When the poll sees `status: 'none'` during a
   flow, the banner toasts "Linear connected — N agent(s) resumed" and
   unmounts.
2. **Callback relay (fallback disclosure).** On a remote session the
   localhost callback page fails to load in the operator's browser — the
   operator copies the URL from the address bar into the banner's callback
   field, which POSTs it to `/api/linear-mcp-auth/callback`. The server
   validates it (localhost URL with `code` and `state` parameters), then
   messages the URL-owning agent with the exact
   `mcp__linear__complete_authentication` call to make, and appends a
   `callback_relayed` event.
3. **Mark completed (fallback disclosure).** If the operator authorized
   another way (e.g. `claude mcp login linear`), "Already authorized another
   way? Mark completed" POSTs to `/api/linear-mcp-auth/complete`, which
   appends a `healthy` event with `source: 'operator'`, closing the
   lifecycle. Blocked agents are woken to re-check; the banner returns if
   authentication is still broken.

## Connect and verify routes

Both routes reject requests without a trusted origin with `403`, return at
once (the banner polls `GET /api/linear-mcp-auth` for the outcome), and send
messages only through `messageAgent()` in `src/lib/agents/messaging.ts`. The
logic lives in `src/lib/linear-mcp-auth-connect.ts` and
`src/lib/linear-mcp-auth-verify.ts`.

| Route | Result | Response |
| --- | --- | --- |
| `POST /api/linear-mcp-auth/connect` | link usable | `200 { action: 'open', authUrl, authUrlAgentId }` |
| | refresh request delivered (or throttled) | `202 { action: 'refreshing', requestedFrom, previousAuthUrl }` |
| | no open lifecycle | `409 { success: false, error: 'No Linear authorization is pending' }` |
| | no candidate reachable | `409 { success: false, error }` |
| | no trusted origin | `403 { error }` |
| `POST /api/linear-mcp-auth/verify` | no open lifecycle | `200 { alreadyConnected: true }` |
| | owner messaged (or throttled) | `202 { requestedFrom }` |
| | no `authUrlAgentId` | `409 { success: false, error: 'No blocked agent owns the active Linear authorization URL' }` |
| | owner not delivered | `409 { success: false, error }` |
| | no trusted origin | `403 { error }` |

- **Usable link.** `status === 'active'`, `authUrl !== null`, and the owner is
  not confirmed dead (`isConfirmedDead(await isAlive(owner))` from
  `src/lib/agents/liveness.ts`). A thrown probe or `runtime-indeterminate`
  counts as alive, so a broken probe never forces a needless refresh. The
  owner matters because Claude Code runs the OAuth callback listener inside
  the owner's process.
- **Refresh candidates.** `authUrlAgentId` first, then the other blocked
  agents by `declaredAt` newest first, de-duplicated. The first
  `delivered: true` outcome wins; a throw or `delivered: false` moves on.
- **Throttles** (in-memory rate limits keyed by the lifecycle's
  `declaredAt`, not stored state): a refresh is not resent within
  `LINEAR_MCP_AUTH_REFRESH_THROTTLE_MS` (60 s), because a second
  `mcp__linear__authenticate` call can replace the callback listener and
  break the tab the operator already has open; a verify is not resent within
  `LINEAR_MCP_AUTH_VERIFY_THROTTLE_MS` (15 s).
- **Message copies.** Neither reuses `LINEAR_MCP_AUTH_WAKE_COPY`, because
  that copy tells the agent to call `mcp__linear__authenticate` again on
  failure, which would mint a new URL mid-flow.
  - `LINEAR_MCP_AUTH_REFRESH_COPY` (caller `linear-mcp-auth-refresh`): "The
    Linear authorization link you generated has expired and the operator
    wants to connect now. Call mcp__linear__authenticate exactly once to
    generate a fresh authorization URL, state the URL in one sentence, then
    stop and wait — Overdeck shows the link to the operator and wakes you
    when authentication is restored. Do not do anything else."
  - `LINEAR_MCP_AUTH_VERIFY_COPY` (caller `linear-mcp-auth-verify`): "The
    operator approved Linear access in their browser. Re-check Linear access
    now with exactly one lightweight read (e.g. mcp__linear__list_issues with
    a limit of 1). If it succeeds, resume your canonical task. If it fails or
    the Linear tools are unavailable, do NOT call mcp__linear__authenticate —
    stop and wait; the operator will retry from the dashboard."

## Wake semantics

When a lifecycle closes, `processLinearMcpAuthWake()` (coalesced, one global
run at a time) messages every blocked agent in the completed lifecycle that
has not yet been notified:

- Delivery goes through the sanctioned delivery door (`messageAgentWithOutcome`
  in `src/lib/agents/messaging.ts`) — never raw tmux keystrokes.
- The message (`LINEAR_MCP_AUTH_WAKE_COPY`) tells the agent to re-check Linear
  access with one lightweight read and resume its canonical task, and not to
  retry in a loop if it still fails.
- Each delivery goes through the **keyed wake outbox**: one JSON entry per
  `(lifecycleId, agentId)` at
  `~/.overdeck/agents/<agentId>/linear-mcp-wake/<lifecycleId>.json`, carrying
  the intended message, a `pending`/`acknowledged` state, and the recorded
  outcome. Writes are temp-file + rename (atomic on POSIX) and all I/O is
  async. The delivery wrapper (`deliverWakeWithOutbox`) creates the entry
  before sending and records the acknowledgment — with the real outcome
  (`delivered`, `queued`, or `failed`) — as part of its own protocol on every
  path, so every acknowledged send has a receipt.
- **The side effect itself is deduplicated by key at the delivery door.** The
  outbox makes an *incomplete* first delivery replayable, but it cannot help
  a *completed* delivery whose ack was lost to a dashboard crash — that is
  why the wake key (`linear-mcp-auth-wake:<lifecycleId>`) is also threaded
  through `messageAgentWithOutcome` into `deliverAgentMessage`, where the
  crash-independent components deduplicate the injection itself. Only tiers
  whose crash-independent component enforces the key across the COMPLETE
  visible side effect may carry a keyed message; the others acknowledge
  receipt without enforcing the key, so keyed payloads bypass them entirely
  (auto mode skips them; requesting one explicitly with a key is a loud
  error, not a silent downgrade):
  - **PTY supervisor** keeps a per-server set of delivered keys and reserves
    a key synchronously before injecting, so two concurrent same-key requests
    coalesce onto one injection instead of racing past the dedup check. Its
    own exit kills the agent with it (H1 lifecycle), so an in-memory set is
    exactly as durable as the side effect it guards: a replay after a
    dashboard crash hits the surviving supervisor and gets
    `{ deduplicated: true }` instead of a second PTY write; a replay after
    the agent itself died is a legitimate first delivery to the resumed
    session. The supervisor's single request covers content AND the
    standalone Enter, so the key completes only after the full submission.
    If the keyed request's RESPONSE is lost (timeout/reset), the outcome is
    ambiguous — the supervisor may have injected — so the dashboard does NOT
    cross to the tmux tier (its key store is independent); it raises an
    `AmbiguousKeyedDeliveryError` instead, the wake outbox entry stays
    `pending`, and a later wake pass retries the SAME key at the SAME tier,
    where the supervisor's reservation/delivered set deduplicates it. Only a
    received non-2xx (a definitive, purged failure) may fall back to tmux.
  - **tmux fallback** uses per-session markers owned by the tmux server
    (`sendKeysDedup` + `completeKeyedSubmit`): the paste, the PENDING claim,
    AND the receiving pane's pid (TARGET, via `set-option -F '#{pane_pid}'`)
    are one atomic server-side `if-shell` step, and the submission itself is
    a second single `if-shell` — only when PENDING is present, TERMINAL is
    absent, the pane is alive, AND the current pane IS the recorded paste
    target does the server send the Enter and then set the POISON breadcrumb
    and the TERMINAL marker and clear PENDING, all inside one server-executed
    command list. The terminal is therefore PROVISIONAL from the moment it
    exists: a dashboard crash anywhere leaves poison+terminal together, and
    the breadcrumb forces any later keyed call to repair (roll back to
    pending, verify, lift the breadcrumb) instead of honoring the marker as
    a dedup. The pre-branch liveness check is NOT treated as proof of
    acceptance: the pane can die in the shell-to-branch handoff, and tmux
    reports `send-keys` into a remain-on-exit corpse as success. So after the
    command, the target is re-read — and the key may only lose its
    provisional status when BOTH target reads succeeded, BOTH report a live
    pane, and the pid identity matches (an unreadable pre-target fails
    CLOSED). A pane that was REPLACED around or after the paste no longer
    matches the recorded target: the submit refuses, and recovery RE-PASTES
    the real content into the replacement pane rather than completing with a
    blank Enter. If the target was lost around the Enter, the terminal
    marker is ROLLED BACK as a verified transition and
    `KeyedSubmitTargetDeadError` is thrown. Every safety-critical read —
    the initial poison read, repair and rollback verification, and the
    post-clear verification — is strict: a rejected read aborts as
    `KeyedMarkerVerificationError` (cause preserved) with the breadcrumb
    authoritative, never converted to empty state. Every poison-clear failure
    — the clear command, the post-clear verification read, or a surviving
    breadcrumb — is the same recoverable class, so a transient failure
    before any side effect or a repair that stops mid-way is never recorded
    as terminal `failed`. (A genuinely missing target is classified upstream
    at the messageAgent stopped/zombie layer, which resumes and re-delivers.)
    The outbox entry stays `pending` on every recoverable failure and a later
    pass re-drives the wake after the agent resumes — recovery never
    suppresses a wake that did not demonstrably reach a live harness holding
    the real content. A failed Enter aborts the command
    list before the terminal transition, and concurrent or post-crash
    callers lose the server-side condition, so no stray Enter can land in a
    composer holding unrelated operator text.
  - **Monitor mail spool (PAN-3015) never carries keyed deliveries.** The
    monitor claims a mail file by renaming it before emitting, so a monitor
    exit between claim and emit would lose the wake and a post-emit/pre-ack
    crash would replay it — the spool cannot enforce the key across the
    model-visible side effect. Keyed messages skip the monitor tier and use
    the supervisor/tmux door; keyed payloads are also never written as mail
    backups on delivered paths, because a monitor started later would drain
    the file as a second visible copy. (The one mail file a keyed delivery
    can still produce is the **gated-agent queue** below — a separate
    mechanism from the monitor spool.)
  - **Resume paths (suspended/stopped/zombie)** never let a keyed message
    ride the resume kickoff prompt: the kickoff is delivered by components
    that cannot enforce the key. The agent is resumed with its bare
    auto-continue prompt and the keyed message then goes through the keyed
    door of the new session.
  - **Remote agents** run the same two-phase marker protocol against the
    REMOTE tmux server (`sendToRemoteAgentKeyed`), which is the
    crash-independent component for a remote session. The production executor
    throws on any non-zero SSH exit — a failed write, paste, or Enter-submit
    is never acknowledged as delivery.
  - Channels, codex app-server, and ACP tiers cannot enforce a key and are
    rejected for keyed payloads. Keyed Linear wakes only target Claude Code
    agents anyway — the detection hook is Claude-Code-only.
  - **Gated-agent mail queue** (paused/troubled/operator-stopped agents)
    uses a deterministic keyed filename, so a replayed send overwrites the
    same durable entry instead of stacking a second copy; the outcome is
    recorded honestly as `queued`. This is the only mail path keyed payloads
    take, and it is distinct from the monitor spool: the message is enqueued
    at most once and the wake is never reported as delivered.
- **Recovery semantics.** An agent stays in the wake set until a completion
  DomainEvent lands. When a pass finds no completion, it reads the keyed
  entry (one exact-path async read — no directory scans, no content or
  timestamp matching): `acknowledged` suppresses the replay and the pass only
  retries the completion record, replaying the recorded outcome faithfully
  (`queued` is never upgraded to `delivered`); `pending` or missing means the
  send was never acknowledged, so it is (re)driven — and when the original
  send had in fact completed before the crash, the door-level dedup makes
  that replay a no-op for the agent. The result is exactly one visible
  delivery per agent per lifecycle across every crash window: crash before
  the entry → driven once; crash after a send whose ack never landed →
  replayed, but deduplicated at the door; crash after the ack → never
  replayed. Lifecycle B's entry and key are independent of lifecycle A's, so
  an identical wake message in an adjacent lifecycle is never suppressed.
- **Drain-until-stable.** The wake pass loops: after waking one completed
  lifecycle it re-reads the fold, so a lifecycle that completed while
  deliveries were in flight gets its own wake round inside the same coalesced
  run instead of being swallowed by it. A pass that cannot stabilize after 10
  rounds schedules its own follow-up run with bounded exponential backoff
  (1s doubling to 60s; healthy triggers that arrived mid-run received the
  same coalesced promise, so no external retry is guaranteed, and a
  persistent failure cannot become a hot retry loop).
- **Boot recovery:** the Cloister service runs the wake pass on startup
  (`src/lib/cloister/service.ts`) and on every `linear_mcp_auth.healthy`
  domain event (`src/lib/cloister/service-reactive.ts`), so an agent that was
  stopped when auth completed — or a dashboard that restarted mid-flow — still
  gets its wake on the next pass.

## Tests

- `tests/scripts/linear-mcp-auth-hook.test.ts` — hook contract: URL
  extraction, auth-error → required, marker-deduped healthy, silent exit on
  garbage.
- `src/lib/__tests__/linear-mcp-auth*.test.ts` — fold, projection, wake set,
  and wake outcomes.
- `src/lib/__tests__/linear-mcp-auth-connect.test.ts` — open vs refresh,
  candidate order, unreachable, refresh throttle.
- `src/lib/__tests__/linear-mcp-auth-verify.test.ts` — verify request, copy,
  throttle, unreachable.
- `src/dashboard/server/routes/__tests__/linear-mcp-auth.test.ts` — the five
  routes, conversation URL/title projection, callback validation, origin
  checks.
- `src/dashboard/frontend/src/hooks/__tests__/useLinearConnectFlow.test.tsx` —
  the Connect Linear flow under fake timers.
- `src/dashboard/frontend/src/lib/__tests__/loopbackHost.test.ts` — the
  loopback host predicate.
- `src/dashboard/frontend/src/components/LinearMcpAuthBanner.test.tsx` —
  banner rows, Connect Linear, progress copy, and the fallback disclosure.
- `src/dashboard/frontend/tests/pan-4464-linear-connect.spec.ts` — Playwright:
  expired link → Connect Linear → mocked success (run `npm run build` first).
