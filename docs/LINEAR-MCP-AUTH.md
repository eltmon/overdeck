# Linear MCP Auth Intervention (PAN-2997)

When an agent's Linear MCP OAuth session is missing or expired, the agent can
only print an authorization URL into its own transcript and block — easy to
miss. Overdeck surfaces that state as **one global dashboard intervention**: a
top banner listing every blocked agent, the OAuth action, and two completion
paths, followed by an automatic wake of each blocked agent once authentication
is healthy again.

Related: [CODEX-AUTH.md](./CODEX-AUTH.md) — the same top-banner treatment for
GPT/Codex OAuth failures.

## Detection: the hook contract

`sync-sources/hooks/linear-mcp-auth-hook` is a Claude Code **PostToolUse** hook
registered with matcher `mcp__linear__.*` (see `HOOK_SCRIPT_NAMES` and
`OVERDECK_HOOK_REGISTRATIONS` in `src/lib/claude-hooks-registration.ts`). It
never breaks Claude Code — every failure mode exits 0 silently.

The hook emits heartbeat events via `pan_emit_event` (see
`sync-sources/hooks/pan-hook-lib.sh`). Its emitted `kind` strings are a
load-bearing contract with the ingestion layer — a copy-edit that renames them
silently breaks detection:

- `linear_mcp_auth_required` — emitted when:
  - `mcp__linear__authenticate` returns; the first
    `https://linear.app/oauth/authorize…` URL in the tool response is extracted
    into `authUrl` (`null` when extraction fails); or
  - any `mcp__linear__*` tool response matches an auth-error pattern
    (`requires authentication|not authenticated|unauthorized|401`), with
    `authUrl: null`.
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
| `linear_mcp_auth.notified` | `{ agentId, issueId, outcome: 'delivered' \| 'queued' \| 'failed' }` | The wake pass, after messaging a blocked agent |
| `linear_mcp_auth.callback_relayed` | `{ agentId, issueId }` | `POST /api/linear-mcp-auth/callback`, after relaying a callback URL |

## Lifecycle fold semantics

`foldLinearMcpAuthEvents` in `src/lib/linear-mcp-auth.ts` reduces the event log
into one **open lifecycle** plus the last completed one:

- **One open lifecycle.** The first `required` event opens it; every later
  `required` dedups into it — agents are keyed by `agentId`, so repeated auth
  failures from the same agent update its row instead of minting a new OAuth
  request, and additional agents join the same intervention.
- **authUrl ownership.** The most recent `required` event carrying a non-null
  `authUrl` owns the intervention's authorization URL (`authUrlAgentId`). The
  URL is the agent-generated OAuth link the operator opens.
- **Expiry TTL.** URLs expire after `LINEAR_MCP_AUTH_URL_TTL_MS` (30 minutes)
  from declaration unless the event carries its own `expiresAt`. The
  projection reports `status: 'expired'` once the TTL passes; the link
  refreshes automatically the next time a blocked agent emits a fresh
  `required` with a new URL.
- **Close.** Any `linear_mcp_auth.healthy` event closes the open lifecycle
  (it becomes `lastCompleted`, and the projection returns to `status:
  'none'`). `notified` events stamp `notifiedAt` on the agent row in whichever
  lifecycle is current; `callback_relayed` is record-keeping only.
- **Projection.** `resolveLinearMcpAuthIntervention()` serves `GET
  /api/linear-mcp-auth` with `{ status, authUrl, authUrlAgentId,
  authUrlExpiresAt, declaredAt, blockedAgents[] }`. Because the fold reads the
  durable event store, banner state survives dashboard restarts.

## Banner states

`src/dashboard/frontend/src/components/LinearMcpAuthBanner.tsx` (mounted in
`AppChrome.tsx` under `CodexAuthBanner`; polling hook
`src/dashboard/frontend/src/hooks/useLinearMcpAuthStatus.ts` — 5s while an
intervention is active, 30s when idle):

- **none** — banner hidden.
- **active with authUrl** — "Linear authentication required" header, the
  blocked-agent list with issue links, and an "Open Linear authorization"
  anchor naming the owning agent.
- **active without authUrl** — waiting-for-URL copy: no blocked agent has
  produced an authorization URL yet.
- **expired** — copy stating the link expired and refreshes automatically when
  a blocked agent generates a fresh one.

## Operator completion flows

Two ways to resolve the intervention from the banner:

1. **Callback relay.** The operator opens the authorization URL, approves in
   the browser, and Linear redirects to a localhost callback URL. On a remote
   session the callback page fails to load — the operator copies the URL from
   the address bar into the banner's callback field, which POSTs it to
   `/api/linear-mcp-auth/callback`. The server validates it (localhost URL
   with `code` and `state` parameters), then messages the URL-owning agent
   with the exact `mcp__linear__complete_authentication` call to make, and
   appends a `callback_relayed` event.
2. **Mark completed.** If the operator authorized another way (e.g. `claude
   mcp login linear`), the banner's "Mark completed" button POSTs to
   `/api/linear-mcp-auth/complete`, which appends a `healthy` event with
   `source: 'operator'`, closing the lifecycle. Blocked agents are woken to
   re-check; the banner returns if authentication is still broken.

## Wake semantics

When a lifecycle closes, `processLinearMcpAuthWake()` (coalesced, one global
run at a time) messages every blocked agent in the completed lifecycle that
has not yet been notified:

- Delivery goes through the sanctioned delivery door (`messageAgentWithOutcome`
  in `src/lib/agents/messaging.ts`) — never raw tmux keystrokes.
- The message (`LINEAR_MCP_AUTH_WAKE_COPY`) tells the agent to re-check Linear
  access with one lightweight read and resume its canonical task, and not to
  retry in a loop if it still fails.
- Each attempt is recorded as a `linear_mcp_auth.notified` event with outcome
  `delivered`, `queued`, or `failed`, so an agent is woken at most once per
  lifecycle.
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
- `src/dashboard/server/routes/__tests__/linear-mcp-auth.test.ts` — the three
  routes, callback validation, origin checks.
- `src/dashboard/frontend/src/components/LinearMcpAuthBanner.test.tsx` —
  banner states and both completion flows.
