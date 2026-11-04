# Dashboard Authentication (PAN-1166, PAN-3762, PAN-2351)

How the Overdeck dashboard authenticates browsers, paired devices, scoped API
tokens and non-browser clients, what the `/ws/*` upgrade gate and the remote request gate
defend, and what they do not. User-facing guide:
[configuration/remote-access.mdx](../configuration/remote-access.mdx).

## Credentials

- **Internal token** — the root secret at `~/.overdeck/internal-token` (mode
  `0600`), read by `getInternalToken()` (`src/lib/internal-token.ts`). Sent as
  the header `x-overdeck-internal-token` or `Authorization: Bearer <token>`.
  Resolution order: the file first; `OVERDECK_INTERNAL_TOKEN` only when no
  file exists, and the first `ensureInternalToken()` (dashboard boot,
  `pan serve`, or a CLI sender) writes that value, or a random one, to the
  file. A pane can inherit a stale `OVERDECK_INTERNAL_TOKEN` from a
  long-lived Herdr or tmux server, so the env value never overrides the
  file (PAN-4628). Never rotated automatically.
- **Session cookie** — `overdeck_session`
  (`DASHBOARD_SESSION_COOKIE`, `src/dashboard/server/routes/dashboard-auth.ts`).
  Its value is an HMAC of the internal token (context
  `overdeck-dashboard-session-v1`), so it is *derived*, not random: a dashboard
  restart does not invalidate cookies minted before it. Attributes: `Path=/;
  HttpOnly; SameSite=Strict; Max-Age=2592000` (30 days, rolling), host-only.
- **Device session** (PAN-3762) — a paired device's own `odk_<64 hex>` token,
  sent as the cookie `overdeck_device` (`DASHBOARD_DEVICE_COOKIE`, same
  attributes as `overdeck_session`) or as `Authorization: Bearer odk_…`
  (desktop clients). Revocable one device at a time; see "Device sessions".
- **Access token** (PAN-2351) — a scoped `odk_<64 hex>` token for a sidecar,
  Hermes or a script: a `kind: 'token'` record in the same registry, created
  with `pan token create` or `POST /api/access-tokens`. It authenticates only
  from `Authorization: Bearer odk_…`, carries named scopes (see "Scopes"), and
  is revocable one token at a time.
- **Machine credential** (PAN-4645) — a linked machine's `odk_<64 hex>` token: a
  `kind: 'machine'` record bound to that machine's public key (`machineKey`),
  environment id and access level, minted by the pairing exchange
  (`POST /api/machines/exchange`). It authenticates only from `Authorization:
  Bearer odk_…` **inside a secure channel** whose handshake proved that key
  (D-4645-9); the same token over plain HTTP, or over a channel another key
  opened, resolves to `null`. Scopes come from `MACHINE_TOKEN_SCOPES(access)`.
  Revocable per machine (`DELETE /api/machines/inbound/:tokenId`); revoking
  closes that machine's channels. See `docs/ANYWHERE-ARCHITECTURE.md`.
- **Phone credential** (PAN-4835) — the phone app's `odk_<64 hex>` token: a
  `kind: 'phone'` record bound to the phone's link key (`phoneKey`), its
  directory client id (`clientId`) and an optional push key, minted by
  `POST /api/phones/exchange`. It authenticates only from `Authorization:
  Bearer odk_…` inside a secure channel whose handshake proved `phoneKey`; the
  resolved shape is `{ kind: 'phone', tokenId, clientId, phoneKey, scopes }`.
  Carries `PHONE_TOKEN_SCOPES` (eight scopes, never `admin` or `forward`).
  See "Phone credentials (PAN-4835)" below.
- **Connector credential** (PAN-4927) — an Overdeck connector's `odk_<64 hex>`
  token: a `kind: 'connector'` record bound to the connector's link key
  (`connectorKey`) and its directory client id (`clientId`), minted by
  `POST /api/connectors/exchange`. It authenticates only from `Authorization:
  Bearer odk_…` inside a link-mode channel whose handshake proved
  `connectorKey`; the resolved shape is
  `{ kind: 'connector', tokenId, clientId, connectorKey, scopes }`. Carries
  only scopes from `CONNECTOR_SCOPE_CHOICES`. See "Connector credentials
  (PAN-4927 W-CONN1)" below.
- **Agent token** (PAN-4927) — a managed agent's or conversation's own
  `odk_<64 hex>` token; see "Agent tokens (PAN-4927)" below.
- **CSRF token** — an HMAC token returned by the session mint and sent back on
  mutating requests as `x-overdeck-csrf-token`. Only checked for mutations
  (`rejectUnsafeDashboardMutationRequest`); WebSocket upgrades never carry it.
  It is one global value; a revoked device's cookie no longer authenticates, so
  the shared CSRF token alone grants nothing.

`resolveDashboardCredential(headers, channel)` (`dashboard-auth.ts`) is THE
credential check; `channel` is the secure-channel marker of the connection the
request arrived on (`channelOfRequest`, `channel-peer.ts`) or `null`. It returns
`{ kind: 'internal-token' }`, `{ kind: 'root-session' }`,
`{ kind: 'device', deviceId, scopes }`, `{ kind: 'token', tokenId, scopes }`,
`{ kind: 'machine', tokenId, machineKey, environmentId, access, scopes }`,
`{ kind: 'phone', tokenId, clientId, phoneKey, scopes }`,
`{ kind: 'connector', tokenId, clientId, connectorKey, scopes }`, or `null`, in
that precedence. A `machine` record needs `channel.mode === 'link'` and
`channel.remoteKeyHex === record.machineKey`; a `phone` record (PAN-4835)
needs the same channel mode and `channel.remoteKeyHex === record.phoneKey`; a
`connector` record (PAN-4927) needs the same channel mode and
`channel.remoteKeyHex === record.connectorKey`, and its scopes are filtered to
`CONNECTOR_SCOPE_CHOICES`.
Channel requests are never
loopback peers (`remoteAddress` is `link:<key>`), so the session mint answers
401 to them and the remote request gate treats them as remote. The `odk_` value is read from the
`overdeck_device` cookie first, else the Bearer header. A `kind: 'token'`
record authenticates only from the Bearer header: the same plaintext in the
`overdeck_device` cookie resolves to `null` (D-9). A record with no `kind` is
a device. `credentialScopes(credential)` is `['admin']` for the two root
credentials and the record's scopes otherwise.
`hasDashboardAuthHeaders(headers)` is `resolveDashboardCredential(headers) !==
null`. Every gate in this document reuses it — there is no second credential
check anywhere in the server.

### Agent tokens (PAN-4927)

An agent token is a `kind: 'token'` record that also carries `agentId` (an
agent id such as `agent-pan-1`, or a conversation name), `agentKind`
(`'agent'` or `'conversation'`) and `role` (the agent's role, or
`'conversation'`). The three fields are valid only on `kind: 'token'` and only
all together; on any other kind, or incomplete, they make the registry file
corrupt. An agent token never carries `admin` or `forward`, and its scopes come
only from `AGENT_TOKEN_SCOPES` (table under "Scopes"). A Bearer agent token
resolves to `{ kind: 'token', tokenId, scopes, agentId, agentKind, role }`; a
plain token's credential has none of the three keys.

`src/lib/mcp/agent-token.ts` owns the lifecycle. It reads the registry file
fresh (`readActiveAccessTokenRecord`, `revokeAccessTokensMatching`), never the
in-memory snapshot, so it works in CLI processes too.

- **Token file.** `ensureAgentMcpToken(owner)` writes the plaintext to
  `<owner dir>/mcp-token`, mode `0600`, by temp file plus rename. The owner
  directory is `~/.overdeck/agents/<agentId>/` for agents and
  `~/.overdeck/conversations/conv-<name>/` (`conversationStateDir`) for
  conversations. It reuses the file's token while that token is active, names
  the same owner and role, and has exactly the role's scopes; otherwise it
  revokes the owner's tokens and mints one. A mint the registry lost to another
  process's write is minted once more, then the call throws.
- **Revoke on stop.** The owner's tokens are revoked and its file unlinked by
  `stopAgent` (`pan kill`, the dashboard stop route, the spawn failure catch),
  `stopAgentSync` (fire and forget), the supervisor `exited` event (agents and
  conversations), issue close-out, and `stopConversationRuntime` (conversation
  stop, archive, restart-all, lanes, the Flywheel). Every revoke logs one
  warning on failure and never fails the stop.
- **Sweep.** The primary dashboard runs `agent-token-sweep.ts` 60 s after boot,
  then 10 minutes after each run ends. It revokes the tokens of agents with no
  state, agents the liveness oracle confirms dead (after a 10-minute grace from
  mint, start or resume), and conversations whose row is missing, archived, or
  ended. It then removes agent-token records revoked more than 7 days ago
  (`pruneEndedAccessTokens`); an unrevoked OAuth record is removed 7 days
  after it expires, and a revoked one 7 days after its sign-in's 90-day
  refresh window has closed (`revokedAt` + 90 days), so a refresh can always
  see that its access token was revoked; other records are never pruned.
- **Older versions.** An Overdeck that predates PAN-4927 ignores the extra
  fields and reads an agent token as a plain token, so a downgrade keeps the
  file valid.

### OAuth sign-ins for /mcp (PAN-4945)

Hosted MCP clients sign in through OAuth 2.1 (authorization code with PKCE
S256, dynamic client registration, public clients only). User guide:
[configuration/mcp.mdx](../configuration/mcp.mdx) "Sign in with OAuth".

- **Record fields.** An OAuth access token is a `kind: 'token'` record that
  also carries `oauthClientId` (`odc_` + 32 hex), `oauthFamilyId` (32 hex, the
  sign-in) and `expiresAt` (ISO 8601). `oauthFieldsValid`
  (`src/lib/access-token-records.ts`) requires all three or none, only on
  `kind: 'token'`, and never together with the agent fields; anything else
  makes the registry file corrupt. `createAccessToken` refuses `admin`,
  `forward`, `read:settings`, `read:costs` and `read:events` on an OAuth token.
  The resolved credential is `{ kind: 'token', tokenId, scopes, oauthClientId }`.
- **Expiry.** `verifyAccessToken` and `listActiveRecordsOfKind` treat a record
  at or past `expiresAt` as inactive; `readActiveAccessTokenRecord` does not,
  so an expired token can still end its sign-in through `POST /oauth/mcp/revoke`.
  Expiry fires no `onAccessTokensRevoked` event: `/mcp` is stateless, so the
  next request fails, but a long-lived `/ws/*` socket is not closed at expiry.
- **The store.** `~/.overdeck/mcp-oauth.json` (`src/lib/mcp/oauth-store.ts`,
  mode 0600, temp file plus rename) holds registered clients and sign-ins
  (families). A family stores its refresh token only as a SHA-256 digest, plus
  up to 20 digests of retired refresh tokens for reuse detection, and names its
  current access token by `accessTokenId`. Every read prunes families ended
  more than 7 days ago and clients with no family created more than 24 h ago.
  A malformed file throws and is never overwritten. Approvals and authorization
  codes live only in memory (`src/lib/mcp/oauth-service.ts`).
- **Rotation and theft.** Each refresh replaces both tokens and revokes the
  family's other access tokens. A retired refresh token, a reused authorization
  code, or a current access token revoked by another path (Settings → Access
  Tokens, `pan token revoke`) ends the whole family.
- **Issuer allowlist.** Every metadata URL is built from the trusted origin
  (`getTrustedOrigins()`) whose host equals the request's `Host`, then
  `X-Forwarded-Host`; a Funnel request uses the Funnel base. The raw header is
  never echoed, and an unknown host gets 400. The MCP SDK client refuses a
  `resource` whose origin differs from the URL it called, which is why the
  issuer follows the request.
- **Routes.** `/.well-known/oauth-protected-resource[/mcp]`,
  `/.well-known/oauth-authorization-server` and `/oauth/mcp/*` (register,
  authorize, authorize/status, token, revoke) are outside the gate's `/api/`
  and `/events/` prefixes and check their own input
  (`src/dashboard/server/routes/mcp-oauth.ts`). The gate's Funnel rule still
  answers them 404. The authorize page escapes every value and sends a nonce
  CSP with `connect-src 'self'`, `frame-ancestors 'none'` and `form-action 'none'`.
- **Operator routes.** `GET /api/mcp-oauth/approvals`,
  `POST /api/mcp-oauth/approvals/:id`, `GET /api/mcp-oauth/sign-ins`,
  `DELETE /api/mcp-oauth/sign-ins/:familyId` and `POST /api/mcp-oauth/issue`
  (`routes/mcp-oauth-admin.ts`) stay `admin` at the gate and then admit only
  the internal token or the root session. `pan mcp oauth` calls them.
- **Older versions.** An Overdeck that predates PAN-4945 ignores the three
  fields, so it accepts an expired OAuth access token until it is revoked.

## Scopes

Every registry credential (device or token) carries scopes from
`ACCESS_TOKEN_SCOPES` (`src/lib/access-tokens.ts`):

- `admin` satisfies every scope. Root credentials are `admin`.
- `operate` satisfies `tell`.
- `read:events`, `read:state`, `read:conversations` and `tell` are independent
  grants; only `admin` implies them.
- `approve` (PAN-4649) is an independent grant to answer blocking prompts:
  permission prompts, pane-choice menus, pi asks, Codex approvals, plan
  approvals and agent questions. Only `admin` implies it; `operate` does not.
- An unknown scope string in the registry file parses but satisfies nothing
  (`scopeSatisfies`), so a hand-edited record fails closed.

An agent token (PAN-4927 D-8) carries `AGENT_TOKEN_SCOPES[role]`
(`src/lib/mcp/agent-token.ts`), never `admin`, `forward`, `read:settings` or
`read:costs`:

| Role | Scopes |
| --- | --- |
| `work`, `worker`, `plan`, `strike`, `sequencer`, `knowledge`, `flywheel` | `read:events`, `read:state`, `read:conversations`, `tell`, `operate` |
| `review`, `test`, `ship` | `read:events`, `read:state`, `read:conversations`, `tell` |
| `conversation` | `read:events`, `read:state`, `read:conversations`, `tell`, `operate`, `approve` |

Pairing always grants a device `['admin']`; a hand-edited device record with
narrower scopes is honored as narrower. The one table of which scope each route
needs is `ROUTE_SCOPES` in `src/dashboard/server/route-scopes.ts`. Anything it
does not list needs `admin` (D-6):

| Scope | `METHOD path` |
| --- | --- |
| `read:events` | `GET /events/stream`, `GET /events/version`, RPC `pan.replayEvents` (PAN-4835) |
| `read:state` | `GET /api/issues`, `GET /api/agents`, `GET /api/agent-directory`, `GET /api/flywheel/status`, `GET /api/pipeline/membership`, `GET /api/versions/self`, `GET /api/activity` (PAN-4835), RPC `pan.getSnapshot` (PAN-4835), `GET /api/lanes`, `GET /api/lanes/:name`, `GET /api/self/workers`, `GET /api/self/workers/:id`, `GET /api/self/workers/:id/wait`, `POST /api/self/lanes/wait` (PAN-4938) |
| `read:conversations` | `GET /api/conversations`, `GET /api/conversations/:id`, `GET /api/conversations/:name/messages`, `GET /api/conversations/:name/about`, `GET /api/palette/search`, `GET /api/conversations/pending-input` (explicit row, PAN-4835), `GET /api/needs-you` (PAN-4944) |
| `tell` | `POST /api/agents/:id/message`, `POST /api/agents/:id/tell`, `POST /api/conversations/:name/message`, `POST /api/conversations/:name/delete-image` (the undo of `upload-image`, PAN-4835), `PUT /api/phones/self/push-key`, `DELETE /api/phones/self` (PAN-4835), `POST /api/self/lanes/report` (PAN-4938) |
| `operate` | WebSocket `/ws/terminal` (`WS_TERMINAL_SCOPE`), `POST /api/conversations`, `POST /api/workers`, `POST /api/versions/self/update`, `DELETE /api/versions/self/update`, `POST /api/self/workers`, `POST /api/self/lanes` (PAN-4938) |
| `approve` | `POST /api/conversations/:id/permission`, `POST /api/conversations/:id/pane-choice`, `POST /api/conversations/:id/pi-ask-answer`, `POST /api/conversations/:id/codex-approval`, `POST /api/conversations/:name/plan-action`, `POST /api/agents/:id/answer-question`, `POST /api/agents/:id/plan-action`, `POST /api/agents/:id/permissions/:requestId/respond` |
| `admin` | everything else, including `/ws/rpc`, `/ws/voice`, `/ws/autopreso` |

The rows PAN-4835 added are not phone-exclusive (D-8): they widen the same
scope for a linked machine's operator token and any API token holding that
scope too, since those credentials already hold the scope as part of their
own grant. `POST /api/conversations/:name/delete-image` pairs with
`upload-image`, already `tell`.

A `:param` segment matches exactly one non-empty segment; matching is exact and
case-sensitive on the normalized path, so any mismatch needs `admin`. Three
places read the table: the remote request gate, `authorizeDashboardUpgrade`,
and the per-route helper `rejectUnauthorizedDashboardRequest` (and so
`rejectUnsafeDashboardMutationRequest`). The helper covers routes outside the
gate's prefixes, such as `GET /knowledge-viewer/*`.

A registry credential is judged by its scopes, never by its peer (D-7): a
narrow token from `127.0.0.1` still gets 403 on an `admin` route. A credential
without the required scope gets **403**
`{ "error": "insufficient_scope", "missingScope": "<scope>" }` (HTTP) or a 403
upgrade rejection. A missing or invalid credential stays **401**.

### `/mcp` (PAN-4649)

`/mcp` serves the MCP tool module (`src/lib/mcp/`) over streamable HTTP. It is
outside the gate's `/api/` and `/events/` prefixes, so the gate does not see it,
and it is not in the route-scope table: `rejectUnauthorizedDashboardRequest`
would demand `admin` for it. The route checks the credential itself, in order:
an untrusted `Origin` that is present → 403, no internal token configured →
503, no credential → 401 (with `WWW-Authenticate: Bearer
resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"` when the
host is a trusted origin, PAN-4945), a credential that is not `kind: 'token'` (the
internal token, the root session, a paired device) → 403, a token carrying
`admin` → 403. MCP never runs with a root credential (parent PRD D-21).

Each tool then calls an ordinary dashboard route over the loopback URL with the
caller's own Bearer token, so the route that tool proxies enforces its scope
through this table and a revoked token fails its next request. The one check
the tool layer adds is `approve` on `answer_question`, because that tool posts
to the `tell`-scoped message route. The server also lists and runs only the
tools whose `scope` the token satisfies, and `audience: 'agent'` tools only
for a token that carries `agentId` (PAN-4927 D-14); a hidden tool answers like
an unknown one. `pan mcp serve` takes the token from `OVERDECK_MCP_TOKEN` or a
0600 `OVERDECK_MCP_TOKEN_FILE`. The endpoint is stateless (a fresh MCP
server per `POST`, no session); `GET /mcp` and `DELETE /mcp` answer 405 with
`Allow: POST`. See [configuration/mcp.mdx](../configuration/mcp.mdx).

### `/api/self/*` (PAN-4927)

A self route acts for the agent that calls it. The route-scope table admits it
by scope like any other route: `GET /api/self/jobs/:id` and
`GET /api/self/jobs/:id/wait` need `read:state`. The handler then requires an
agent token, a `token` credential with `agentId` (`src/dashboard/server/self-caller.ts`).
Every other credential gets **403**
`{ "error": "self routes need an agent token", "code": "not-an-agent-token" }`,
including the internal token, the root session, a device, a plain token and an
unauthenticated local call that the gate let through. A token whose agent has
no `state.json` (or an empty workspace), or whose conversation has no row,
gets **404** `{ "code": "agent-gone" }`. The agent always comes from the
token; a self route never reads an agent, issue or conversation from the body,
query or headers.

Self routes that run a CLI-only operation start a **job**
(`src/dashboard/server/services/self-jobs.ts`). A job runs one verb from a
closed set of `pan` commands (`services/self-job-argv.ts`), with argv built
only from validated pieces, so caller text never lands before the verb's
fixed prefix or as a flag. It runs through `execFile` in the agent's
workspace, or the conversation's `cwd`, with only that agent's identity
variables: `OVERDECK_AGENT_ID` for an agent; for a conversation, both
`OVERDECK_CONVERSATION` and `OVERDECK_AGENT_ID` set to its tmux session (not
its name), as its own launcher exports them, so `pan handoff self` and
`pan task claim` resolve to it, plus `OVERDECK_ISSUE_ID` and
`OVERDECK_DASHBOARD_URL`. Identity variables the dashboard inherited, and any
MCP token, are removed. A job times out after 15 minutes and keeps the last
16 KiB of stdout and of stderr. Only its owner can read it; another agent's
job, like an unknown id, gets **404** `{ "code": "unknown-job" }`. Jobs live in
dashboard memory: a finished job is dropped one hour after it ends, at most
200 are held, and a dashboard restart forgets them all.

A wait blocks at most 50 s (`timeoutMs` 1–50,000, default 50,000; anything
else is **400** `bad-timeout`) and returns early when the job ends. It answers
`{ "status": "done", … }` with the exit code and output, or
`{ "status": "running", …, "next": { "tool": "wait_job", "arguments": { "jobId" } } }`,
the call to make again.

The workflow routes (PAN-4927 W-SELF2): `POST /api/self/tasks/claim`,
`/tasks/done`, `/tasks/block`, `/handoff`, `/worker-report` need `tell`;
`POST /api/self/done` needs `operate`, so review, test and ship tokens get the
gate's 403 `missingScope: operate`. Each takes the issue from the agent's
state, never the body; a caller without an issue gets **409** `no-issue` on
the task and done routes; `worker-report` answers **403** `not-a-worker` to
any caller that is not a worker agent; a bad body is **400** `bad-body` or
`bad-request`; a bad id is **400** `bad-job-arg`; a full job store is **429**
`too-many-jobs`. Each starts a job, waits up to 50 s and answers 200 with the
job answer. `handoff` never passes `--cwd` or `--allow-primary`, so the new
conversation inherits the caller's cwd.

The accepted risk: a job runs `pan` with the dashboard user's rights, so the
closed verb set, the argv builder and the token-only caller are the boundary.

PAN-4938 (W-DEL1) adds seven self routes for delegation and lanes
(`routes/self-workers.ts`, `routes/self-lanes.ts`):

| Route | Scope | What it does |
| --- | --- | --- |
| `POST /api/self/workers` | `operate` | Starts a worker on the caller's issue with the caller as parent (an agent's id, a conversation's `conv-<name>`); body `issueId` and `parentId` are ignored. **409** `no-issue` for a caller without an issue. |
| `GET /api/self/workers` | `read:state` | The caller's workers, local and stand-ins for workers on linked machines. |
| `GET /api/self/workers/:id` | `read:state` | One of the caller's workers. |
| `GET /api/self/workers/:id/wait` | `read:state` | Waits at most 50 s for the worker's report (`afterSeq`, `timeoutMs`); answers `done`, `ended` or `running` with `next`. The startup grace counts from the worker's launch. |
| `POST /api/self/lanes` | `operate` | Launches a lane with the calling conversation as parent; body `parent` and `force` are dropped. **409** `not-a-conversation` for an agent. |
| `POST /api/self/lanes/wait` | `read:state` | Waits at most 50 s for the next report of `run`'s lanes or the caller's lanes. **409** `not-a-conversation` for an agent without `run`; **400** `bad-cursor`. |
| `POST /api/self/lanes/report` | `tell` | Files the lane's report through a `lane-report` job. **409** `not-a-lane` unless the caller is a lane conversation. |

A worker belongs to the caller when its `worker.json` or stand-in `remote.json`
names the caller's parent id; another agent's worker gets **404**
`{ "code": "unknown-worker" }`, like an unknown id.

`POST /api/fleet/issues/:id/start` starts an issue on this machine only for an
`odk_` token caller (the MCP `start_issue` tool), through
`spawnIssueAgentForRoute`, the Start button's gates; every other caller still
gets **400** `use-local-start`, because the CLI starts locally itself. When a
token's call is forwarded to a linked machine, an agent-kind agent token is
forwarded with actor `{ agentId }` (PAN-4927 D-9); any other token goes as the
operator, and every token carries its scopes as the ceiling.

Secret requests (PAN-4941, W-SEC1) are self routes too.
`POST /api/self/secret-requests` (`tell`) takes `{ name, prompt, timeoutMs? }`:
`name` matches `^[A-Z][A-Z0-9_]{0,63}$`, `prompt` is 1–300 characters and
`timeoutMs` is 60,000–3,600,000 (default 600,000); bad input is **400**
`bad-name`, `bad-prompt`, `bad-timeout` or `bad-body`. It answers **201** with
`{ requestId, status: "pending", expiresAt, next }`, or **200** with the
agent's pending request for the same name. An agent may hold 20 pending
requests (**429** `too-many-requests`). `GET /api/self/secret-requests/:id/wait`
(`read:state`) blocks at most 50 s and answers `pending` with `next`,
`delivered` with `file` (a path, never the value), `declined` or `expired`.
Only the requesting agent can wait on its request. Requests live in dashboard
memory (`src/dashboard/server/services/agent-requests.ts`), so after a restart
a wait answers **404** `unknown-request`, as it does for another agent's id,
and the agent calls `request_secret` again. The MCP tools over these routes
are `request_secret` and `secret_wait`.

Memory routes (PAN-4940, W-MEM1) are self routes too.
`POST /api/self/memory/facts` (`tell`) takes
`{ id, type, description, title?, body?, tags?, store? }`: `id` matches
`^[a-z0-9][a-z0-9-]{0,79}$`, `type` is one of `feedback`, `project`,
`reference`, `user`, `description` is 1–200 characters on one line, `title`
(optional) is 1–200 characters on one line, `body` (optional) is at most
16,384 characters, `tags` (optional) is at most 20 tags each matching
`^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`, and `store` (optional) is `project`,
`user` or `machine` (`project` by default, `user` for `type: "user"`; `type:
"user"` with `store: "project"` is refused). It runs
`pan memory add <id> --type=… --description=… [--title=…] [--body=…]
[--tags=…] [--user|--machine] --json`. `POST /api/self/memory/search`
(`read:state`) takes `{ query, limit? }`: `query` is 1–500 characters and
`limit` (optional) is an integer 1–20 (default 10), and it runs
`pan memory search --limit=<n> --facts --json -- <query>`. Both run in the
caller's cwd, wait up to 50 s and answer 200 with the job answer; a bad body
is **400** `bad-body`, a bad field is **400** `bad-request`, a bad argv piece
is **400** `bad-job-arg`, and a full job store is **429** `too-many-jobs`. The
MCP tools over these routes are `memory_add` and `memory_search`.

### Agent requests (`/api/agent-requests`)

The operator answers agent requests here
(`src/dashboard/server/routes/agent-requests.ts`).

- `GET /api/agent-requests` needs `read:conversations` and answers the pending
  requests for the Decisions panel. It never answers a value, a result or the
  agent's directory.
- `POST /api/agent-requests/:id/secret` (`{ value }`, at most 65,536 bytes)
  and `POST /api/agent-requests/:id/decline` have no route-scope row, so the
  gate refuses every registry credential (a token, device, machine or phone,
  even one holding `approve`) with **403** `insufficient_scope`. The handler
  also accepts only the internal token or the root session (**403**
  `root-only`), and runs the CSRF and Origin checks for the root session.
- Delivery writes the value to `<agent dir>/secrets/<name>` (0600 in a 0700
  directory) and marks the request `delivered`. When the agent no longer holds
  an active agent token, the request expires, no file is written and the
  answer is **409** `agent-stopped`. A request that is no longer pending is
  **409** `not-pending`.
- The value is never echoed, logged or put in an activity entry. A malformed
  body is **400** with a fixed message, and a failed write logs only the
  error's name. Revoking an agent's tokens deletes its `secrets/` directory.

Only root credentials may create or revoke access tokens, issue pairing
credentials, or revoke a device other than the caller's own (D-11). A device or
token credential gets 403 on those operations, even with `admin`.

A Bearer-borne access token skips the CSRF check in
`rejectUnsafeDashboardMutationRequest`, and a non-GET request carrying
`Authorization: Bearer odk_…` with no `Origin` and no `Referer` passes origin
validation (FR-9). A browser cannot attach an `Authorization` header to a
cross-site request without a CORS preflight the server does not grant. Device
and root-session requests keep both checks.

## Session mint

`POST /api/dashboard/session` (`routes/dashboard-session.ts`,
`dashboardSessionRouteLayer`) is the only way a browser acquires the session
cookie. It requires a trusted (or absent) `Origin`.

A request that authenticates as an **access token** gets **403** and no
`Set-Cookie` (D-12): token clients send the Bearer header on every request.
This check runs before the loopback check, so peer trust cannot turn a token
into a root session. A request that authenticates as a **device** gets the CSRF
token and a refreshed `overdeck_device` cookie, and never `overdeck_session`
(FR-16): a device must never be upgraded to the unrevocable root session.
Otherwise the mint passes when any of these is true:

- the internal token is present (header, Bearer, or the one-time
  `#overdeck_token` URL-hash bootstrap `pan up`/`pan dev` inject), or
- the request's real TCP peer is a **loopback peer** — `127.0.0.1`/`::1`, an
  IP inside a host-local Docker bridge subnet (`peerIsHostLocalDockerBridge`,
  the case host-local Traefik fronting `overdeck.localhost` hits from), or, in
  a container, inside one of the container's own attached-network subnets
  (`peerIsLocalContainerNetwork`) — or
- the request already carries a valid session cookie or internal token
  (`rejectUnauthorizedDashboardRequest`), so a mint from an already-trusted
  caller just refreshes the cookie's rolling `Max-Age`.

Peer trust reads the real TCP peer (`request.remoteAddress`). A
Docker-bridge peer is the one exception (PAN-4299): Traefik connects from a
bridge IP for every client it forwards, LAN clients included, so a bridge peer
is trusted only when its rightmost `X-Forwarded-For` entry is loopback or a
host Docker-bridge IP, or the header is absent (`forwardedClientIsLocal`).
Traefik appends that rightmost entry itself, so a caller can prepend fake
entries but cannot replace it. A local browser shows up there as the bridge
gateway (for example `172.23.0.1`), because it reaches Traefik through
docker-proxy. Literal-loopback and in-container peers do not read the header.
With
`dashboard.require_token_mint: true` (see "Remote request gate"), the loopback
bullet no longer applies: only the internal token or an existing credential
mints.

**Two-host mint** — when `VITE_API_URL` puts the API on a different host than
the page (a workspace dev stack, PAN-3711), `ensureDashboardSession()`
(`wsTransport.ts`) mints on both hosts in parallel; the cookie is host-only, so
each host needs its own mint.

## WebSocket gate

`authorizeDashboardUpgrade(headers, method, requiredScope = 'admin')`
(`src/dashboard/server/ws-auth.ts`) is the single chokepoint all four raw
upgrades route through — `/ws/terminal`, `/ws/rpc`, `/ws/voice`,
`/ws/autopreso`. The one upgrade that happens **before** any credential is
`/ws/link` (PAN-4645): it only carries the secure channel's own handshake, which
is the authentication, and the raw-TCP channel on the dashboard port is the
same thing without HTTP (`channel-listener.ts` reads the first byte; `0x00` is
a channel). Everything that then travels inside the channel, including these
four upgrades, passes this gate like any other connection, with the channel
marker as its credential context. It runs four checks in order:

1. **Origin** (`validateOriginHeaders`) — a *present* `Origin` (or `Referer`)
   must be in `getTrustedOrigins()`, or the upgrade is rejected with **403**.
   An *absent* `Origin` on a GET is allowed through to the next check —
   WebSocket upgrades are GETs, and non-browser clients (a script minting the
   internal token) never send one. Browsers always send `Origin` on upgrades,
   so cross-site WebSocket hijacking is still blocked.
2. **Internal token configured** — if `getInternalToken()` returns nothing,
   the upgrade is rejected with **503** (`dashboard session token not
   configured`) rather than silently trusting an unauthenticated caller.
3. **Credential** (`resolveDashboardCredential`) — the session cookie
   (browsers, attached automatically on same-site upgrades), a device cookie or
   bearer, or the internal token header (non-browser clients). None is a
   **401**.
4. **Scope** — the credential's scopes must satisfy `requiredScope`, or the
   upgrade is rejected with **403** (`Forbidden: missing scope <scope>`).
   `/ws/terminal` passes `operate`; `/ws/rpc` (it carries `terminalWrite` and
   `writeFileAtPath`), `/ws/voice` and `/ws/autopreso` keep `admin`.

On success `authorizeDashboardUpgrade` returns the credential, so the handler
can close a device's or token's socket when it is revoked.

**Peer trust is deliberately NOT consulted here.** A loopback client with no
cookie and no internal token gets 401 on upgrade, even though the same client
could mint a session at `/api/dashboard/session` first. This keeps peer-based
trust confined to one chokepoint — the mint — so the `require_token_mint`
switch (PAN-3762, read from raw `config.yaml`) closes it everywhere at once by
changing the mint alone, without touching four separate upgrade handlers.

Tokens never travel in a URL query parameter (D-10): URLs land in proxy and
access logs. Programmatic WebSocket clients (Node `ws`, Python `websockets`) set
`Authorization: Bearer odk_…`; browsers use the session or device cookie.
`GET /api/environment` reports this gate as `capabilities.terminalAuth: true`
(`WS_UPGRADE_REQUIRES_CREDENTIAL`).

**Heartbeats.** `/ws/rpc` emits a `system.heartbeat` every 15 s and
`/events/stream` sends a `: keepalive` comment every 15 s, so both stay under a
proxy's idle timeout. `/ws/terminal` sends a `\u0000{"type":"ping"}` control frame
every 20 s to clients that connect with `?heartbeat=1`; programmatic Bearer clients
must add that query parameter themselves and answer `{"type":"pong"}`. See the
terminal heartbeat section in [DASHBOARD-ARCHITECTURE.md](DASHBOARD-ARCHITECTURE.md).

Rejected raw upgrades (`/ws/terminal`, `/ws/voice`, `/ws/autopreso`) write a
plain `HTTP/1.1 <status> <message>` response and destroy the socket
(`rejectUpgrade`, `ws-auth.ts`). `/ws/rpc` is Effect-routed and returns a JSON
error response with the same status instead.

The `reauth-*` terminal one-time token (`consumeReauthTerminalToken`,
`ws-terminal.ts`) is an additional check for those sessions only, and runs
*after* `authorizeDashboardUpgrade` — it is unrelated to this gate.

## Device sessions

Registry: `src/lib/access-tokens.ts`, the single door for
`~/.overdeck/access-tokens.json` (mode `0600`, atomic temp-file rename). Each
record is `{ id, name, scopes, tokenHash, createdAt, lastUsedAt, revokedAt?,
kind? }`; `kind: 'device'` marks a paired device and `kind: 'token'` a scoped
access token (PAN-2351). Only the SHA-256 hash of the `odk_` token is stored,
and comparison is constant-time.

- **Verification is synchronous** against an in-memory snapshot, because
  `resolveDashboardCredential` is synchronous. `main.ts` loads the snapshot at
  boot (`refreshAccessTokens()`) and refreshes it every 5 s
  (`startAccessTokenRefresh()`). In-process create and revoke update it at once,
  so a revocation written by another process (the CLI) is honored within 5 s.
- **Fails closed**: a corrupt or unreadable file means zero valid tokens, plus
  an error naming the file. It is never parsed permissively.
- `lastUsedAt` writes are throttled to one per record per minute.

Routes (`routes/pairing.ts`): `GET /api/devices` lists devices (never the
hash). `DELETE /api/devices/:id` revokes one; a device may revoke only itself,
an access token may revoke none (403), and the internal token and root session
may revoke any.

Access-token routes (`routes/access-tokens.ts`): `GET /api/access-tokens`
lists `kind: 'token'` records (never the hash). `POST /api/access-tokens`
takes `{ name, scopes }` and returns `{ token, record }`, the only time the
plaintext is shown. `DELETE /api/access-tokens/:id` revokes one and closes its
live connections; a device id there is 404. Create and revoke accept root
credentials only. `pan token create|list|revoke` (`src/cli/commands/token.ts`)
wraps them: create and list use the registry directly, and revoke calls the
DELETE route, writing the registry only when the dashboard is unreachable
(D-14).

**Revocation closes live connections** (`src/dashboard/server/device-connections.ts`).
Each connection opened by a device or token registers a close callback under
its record id (`revocableCredentialId`), and `DELETE /api/devices/:id` and
`DELETE /api/access-tokens/:id` call `closeDeviceConnections(id)` right after
revoking:

- `/ws/terminal`, `/ws/voice`, `/ws/autopreso` close with code `4401`, reason
  `device revoked` (`trackDeviceSocket`, `ws-auth.ts`).
- `/ws/rpc` runs inside Effect's RPC server, which owns the socket: revocation
  interrupts the handler, and Effect's release closes the socket without a
  close code. The client's reconnect then gets 401.
- `/events/stream` ends through `Stream.interruptWhen`
  (`endStreamOnDeviceRevocation`).

## Pairing

`pan pair` (`src/cli/commands/pair.ts`) calls `POST /api/pairing/credentials`
with the internal token. That route accepts only the internal token or the root
session (plus CSRF for the cookie); a device or an access token gets **403**,
so neither can mint more devices (D-11). It returns an `odp_<64 hex>` credential
(`src/dashboard/server/pairing-credentials.ts`) that:

- is held only in the dashboard's memory, as a SHA-256 hash;
- is single use and expires 10 minutes after issue;
- is lost on a dashboard restart;
- travels only in the URL fragment: `<base>/#pair=<credential>`.

`POST /api/pairing/exchange` is unauthenticated. It checks `Origin` (a present,
untrusted one is **403**), then trades the credential for
`createAccessToken({ kind: 'device' })`. With `delivery: 'cookie'` it sets
`overdeck_device`; with `'bearer'` it returns the token in the body. Expired is
**410**, unknown or reused is **401**, and after 10 failures within 60 s every
exchange is **429** for 60 s (process-wide). Both pairing responses are
`Cache-Control: no-store` and never contain the internal token. In the browser,
`ensureDashboardSession()` (`wsTransport.ts`) strips `#pair=` from the address
bar before any request, runs the exchange, then the normal session mint. A
refused exchange throws `DashboardPairingError`; it never falls back to the
root bootstrap.

## Anywhere routes (PAN-4445)

`routes/anywhere.ts` serves the dashboard's Settings → Anywhere screens. The
pair dialog and Devices panel call the same pairing and device routes as
`pan pair` and `pan devices`.

**`POST /api/anywhere/trusted-origins`** takes `{ origin }` and saves it to
`~/.overdeck/trusted-origins.json` (`{ version: 1, origins }`, written through
a temp file and rename by `addSavedTrustedOrigin()` in
`src/lib/remote-access/trusted-origins.ts`). It answers `200 { origin, added }`,
where `origin` is normalized to `scheme://host[:port]` and `added` is false when
the origin was already trusted.

- Only the **root session** may call it. The internal token (the CLI and every
  pipeline agent), a paired device and a scoped token get **403** (D-5):
  widening origin trust widens the dashboard's attack surface, so it stays
  with the operator's browser on this machine.
- A missing, invalid, non-http(s) or loopback origin is **400**. Loopback
  origins are already trusted for this port and never help another device.
- A saved file that is unreadable or invalid is **500** naming the file; it is
  never overwritten.
- Nothing is written in any refused case.

Saved origins merge into `getTrustedOrigins()` (`routes/origin-validation.ts`)
in **every** launch mode, outside the bare-launch `config.yaml` fallback, so a
Traefik or `OVERDECK_TRUSTED_ORIGINS` launch trusts them too. The route calls
`invalidateTrustedOriginsCache()` after an add, so the next request and the
next WebSocket upgrade from that origin pass with no restart. The file is read
only when the cache fills (`readSavedTrustedOriginsSync()`), never per request.

**`GET /api/anywhere/status`** needs any dashboard credential and returns
`{ machine, addresses, devices, vault, problems, viewer }` with
`Cache-Control: no-store` (`src/lib/remote-access/anywhere-status.ts`).
`addresses` are the trusted origins, each flagged `loopback` by
`isLoopbackOrigin()` (`src/lib/remote-access/loopback.ts`, the one loopback
check, which `pan pair` re-exports as `isLoopbackBase`). `devices.active`
counts unrevoked device records. `problems` are computed on the server, each
with an `action` (`pair-dialog`, `settings-section`, or `none` with an optional
`docsUrl`) that the UI maps to a button. `viewer.kind` is the caller's
credential kind from `resolveDashboardCredential()` (`root-session`, `device`,
`token`, `internal-token`, `machine` for a linked machine over its channel, or `null`); the Continue on another device dialog
offers **Also pair the device** only to the `root-session` (PAN-4455 D-3).

**`POST /api/vault/sessions/by-conversation/:name/settle`** (PAN-4455, Hand off
now, in `routes/vault.ts`) follows the setup, join and sync rule: only the
**root session** or a **paired device** may call it, the internal token and
scoped tokens get **403** without the service running, and every response is
`Cache-Control: no-store`. A device also needs the `admin` scope, which
`route-scopes.ts` already requires for routes it does not list. A conversation
name longer than 100 characters never matches the route.

## Machine links (PAN-4645)

`routes/machines.ts` and `routes/machines-peer.ts` serve Settings → Anywhere →
Machines and `pan machines`. Rules:

- **`POST /api/machines/link`**, **`DELETE /api/machines/:id`**,
  **`POST /api/machines/:id/reconnect`**, **`POST /api/machines/:id/routes`** and
  **`DELETE /api/machines/inbound/:tokenId`** are operator actions: `admin`
  scope, CSRF-checked, and **403** to any request that arrives over a channel
  (a linked machine never manages links here).
- **`GET /api/machines`** needs `read:state`; **`DELETE /api/machines/self`**
  takes exactly a machine credential (the peer unlinking itself).
- **`POST /api/machines/exchange`** runs only inside a **pairing** channel
  (`PAIRING_CHANNEL_ALLOWLIST` in `remote-request-gate.ts`); it mints the
  `machine` token for the key the XXpsk0 handshake proved and consumes the
  pairing credential. **`GET /api/machines/heartbeat`** (SSE) takes a machine
  credential only and ends when that credential is revoked.
- **`/ws/rpc`** from a non-admin credential (machine, device, token) gets the
  restricted RPC group: every tag whose `RPC_METHOD_SCOPES` entry is outside the
  credential's scopes is omitted at upgrade (`ws-rpc-auth.ts`, D-4645-14).
  Revocation closes the socket with 4401 (D-4645-15).
- Scopes for a machine: `read:events`, `read:state`, `read:conversations`,
  `read:costs`, `read:settings`, `tell`, `operate`, plus `forward` at operator
  level. An agent-fenced link stamps `x-overdeck-link-actor: agent:<id>` and
  `x-overdeck-link-ceiling` on forwarded requests (`src/lib/anywhere/link-actor.ts`).
- **Fleet updates (PAN-4654).** `GET /api/versions/self` needs `read:state`.
  `POST` and `DELETE /api/versions/self/update` carry the `operate` row, and the
  handler narrows it further (D-10): through a channel only a machine credential
  on an `operator`-access link with the `operator` actor stamp passes; an
  `agent:<id>` stamp or an agent-fenced link (whose `operator` stamp is
  downgraded to `operator-fenced`) gets `403 fleet-update-forbidden`. Locally the
  CSRF-checked mutation guard applies and a `device` or `token` credential needs
  `admin`. `GET /api/machines/versions` and `POST /api/machines/update` keep the
  `admin` default and answer 403 to any request over a channel.
- Any remote access (trusted remote origin, device, machine link or token) turns
  `require_token_mint` on (`src/lib/remote-access/config.ts`, D-4645-12); a
  plain-HTTP browser on another device gets the Use HTTPS page
  (`plain-http-guard.ts`, D-4645-13).

## Phone credentials (PAN-4835)

`routes/phones.ts` serves the phone app's machine-side identity: a new access-
token kind `kind: 'phone'`, carrying `phoneKey` (the phone's link public key,
64 lowercase hex), `clientId` (the phone app's directory client id, a UUID v4)
and an optional `pushKey` (64 hex, for a later notification-delivery feature).
A phone record always carries `PHONE_TOKEN_SCOPES` — `read:events,
read:state, read:conversations, read:costs, read:settings, tell, operate,
approve` — and `createAccessToken` refuses `admin` or `forward` on a phone
record. A malformed phone record (missing `phoneKey` or `clientId`) makes the
registry corrupt, exactly like an incomplete `machine` record (H-1).

- **Channel binding.** A phone credential resolves only inside a link-mode
  channel whose `remoteKeyHex` equals the record's `phoneKey`; it resolves to
  `null` in a pairing or approval channel, in a link channel opened by another
  key, and on a plain socket (FR-3). `findActiveChannelTokenByKey(keyHex)`
  returns the active `machine`, `phone` or `connector` record pinned to a key, and
  `server.ts` wires it into `isPinnedPeer`, so the link-mode handshake accepts
  a phone's key the same way it accepts a machine's.
- **No CSRF, no Origin.** A phone credential is header-borne and channel-
  bound, so it joins the same skip list as `token` and `internal-token` in
  `rejectUnsafeDashboardMutationRequest` (D-5); there is no ambient cookie to
  abuse.
- **`POST /api/phones/exchange`** is reachable only through a pairing-mode
  channel (`PAIRING_CHANNEL_ALLOWLIST`, same allowlist the machine exchange
  uses). It takes `{ v: 1, clientId, label, pushKeyHex }`, mints the phone
  record bound to the channel's key, then revokes every other active phone
  record with the same `clientId` (one active record per `clientId`). A key
  already held by an active phone record answers **409**
  `{ error, code: 'link-key-in-use' }` rather than revoking its own pairing
  channel's record (D-2) — the phone app must generate a fresh link key for
  every pairing.
- **`DELETE /api/phones/self`** and **`PUT /api/phones/self/push-key`** are
  the phone's own self-service routes: the scope table admits them with
  `tell`, and the handler then requires `credential.kind === 'phone'` (403
  otherwise). Self-revoke may drop the response before it arrives (the
  caller's own channel closes first); the app treats a dropped connection
  after the DELETE as success.
- **Revocation.** Revoking a phone record (by the operator, by
  `DELETE /api/phones/self`, or by another process) closes its `/ws/rpc`
  sockets with 4401 and destroys every channel bound to its `phoneKey` within
  one registry refresh (5 s) — the same `onAccessTokensRevoked` listener that
  already does this for `machine` records.
- **Device list.** `GET /api/devices` returns phone records next to device
  records, each row carrying `kind: 'device' | 'phone'` and no key material;
  `DELETE /api/devices/:id` revokes a phone record the same way.
- **`capabilities.phoneApp`** on `GET /api/environment` tells a phone app the
  machine supports pairing; absent on an older server, which it reads as
  unsupported.
- **No Origin or Referer.** The phone's HTTP and WebSocket client sends
  neither header; `validateOriginHeaders` would otherwise reject a present,
  untrusted `Origin` before any credential check runs (H-2).
- **Out of scope (PAN-4887).** A phone reaches only its paired machine's own
  data. `GET /api/fleet/needs-you`, the `/api/conversations/@<env>/...`
  linked-conversation proxy and the `/ws/linked/:env/rpc` upgrade all still
  refuse every channel caller (the no-chained-hops rule), phone included.

## Connector credentials (PAN-4927 W-CONN1)

`routes/connectors.ts` and `connector-pairing.ts` serve the machine side of a
self-hosted bot. The bot runs an Overdeck connector (`pan mcp connector`),
which pairs once with one machine and then reaches it only through a link-mode
secure channel.

- **Record.** A `kind: 'connector'` access-token record carries `connectorKey`
  (the connector's link public key, 64 lowercase hex) and `clientId` (its
  directory client id, a UUID v4), and no machine, phone, push or agent field.
  `createAccessToken` mints one only with scopes from
  `CONNECTOR_SCOPE_CHOICES` — `read:state, read:conversations, tell, operate,
  approve` — so a connector never holds `admin`, `forward`, `read:settings`,
  `read:costs` or `read:events`. `BOT_DEFAULT_SCOPES` (`read:state,
  read:conversations, tell`) is what "Connect a bot" starts with. A connector
  record missing either field makes the registry corrupt.
- **Channel binding.** A connector credential resolves to
  `{ kind: 'connector', tokenId, clientId, connectorKey, scopes }` only inside
  a link-mode channel whose `remoteKeyHex` equals `connectorKey`; a plain socket, a pairing
  or approval channel, and a link channel from another key all resolve to
  `null`. The resolver filters the record's scopes to
  `CONNECTOR_SCOPE_CHOICES` again, so a hand-edited record with `admin` still
  grants nothing outside the set. `findActiveChannelTokenByKey` returns an
  active connector record, which is what lets the connector's link handshake
  through `isPinnedPeer`.
- **No CSRF, no Origin.** The bearer rides a Noise-authenticated channel, so a
  connector credential joins the skip list in
  `rejectUnsafeDashboardMutationRequest`, like a phone's.
- **`POST /api/connectors/pairing`** (root only: the internal token or the root
  session; an `admin` device or token gets 403) takes `{ name, scopes? }`.
  `name` is 1-64 characters; missing `scopes` means `BOT_DEFAULT_SCOPES`;
  present `scopes` must be distinct values from `CONNECTOR_SCOPE_CHOICES`.
  `read:state` is always added, so every connector can call
  `DELETE /api/connectors/self`. The route issues an ordinary `odp_` pairing
  code, stores the intent `{ name, scopes, expiresAt }` by the code's pairingId
  for 10 minutes, and returns `{ pairingString, expiresAt }` with
  `Cache-Control: no-store`.
- **`POST /api/connectors/exchange`** is reachable only through a pairing-mode
  channel (`PAIRING_CHANNEL_ALLOWLIST`; 401 everywhere else). It takes the
  intent of the channel's pairingId first, so any outcome burns it, and answers
  403 `not-a-connector-code` when there is none. It then parses
  `{ v: 1, clientId, label }` (400 on error), answers 409 `link-key-in-use` for
  a key already bound to an active record, mints the connector record with the
  intent's name and scopes, revokes an older active connector with the same
  `clientId`, and returns `{ v: 1, token, tokenId, scopes, descriptor }` with
  `Cache-Control: no-store`.
- **`GET /api/connectors`** (root only) lists active connectors as
  `{ id, name, scopes, clientId, createdAt, lastUsedAt }`, with no key
  material or hash. **`DELETE /api/connectors/:id`** (root only) revokes one
  (404 for an unknown id). **`DELETE /api/connectors/self`** is the
  connector's own logout: the scope table admits it with `read:state`, and the
  handler requires a `connector` credential. The `:id` route hands `self` to
  the same handler.
- **Cross-refusal.** A code issued for a connector must never pair anything
  else, because the browser exchange would make it an `admin` device.
  `POST /api/pairing/exchange` refuses it with 403 `connector-code` before
  consuming it, so a mistaken paste still lets the connector pair; the refusal
  counts as one failed exchange. `POST /api/machines/exchange` and
  `POST /api/phones/exchange` refuse it the same way, but their handshake has
  already consumed the code, so the operator issues a new one. An expired
  intent still marks its code until it is pruned one TTL later.
- **Revocation.** Revoking a connector record, by any process, closes its
  channels (`registerRevocationClosers`) and its `/ws/rpc` and SSE connections
  (`revocableCredentialId`). The operator and self revoke routes also close
  them at once.
- **`capabilities.connector`** on `GET /api/environment` tells a connector the
  machine supports it; an older server omits it.
- **Downgrade cost.** A `connector` record makes an older Overdeck read the
  registry as corrupt and refuse every token until the record is removed,
  exactly as `machine` and `phone` records do.

## Remote request gate

The server binds `0.0.0.0`, and many routes check only `Origin`.
`src/dashboard/server/remote-request-gate.ts` is one global `HttpRouter`
middleware, merged into `makeRoutesLayer`, that decides whether a request may
reach any route at all:

0. A Tailscale Funnel request may reach only `POST /hooks/*`; anything else is
   **404** (see "Webhook triggers and Tailscale Funnel").
1. The path is not under `/api/` or `/events/` (the static SPA): pass.
2. `METHOD path` is on `REMOTE_GATE_ALLOWLIST`: pass. The list is
   `GET /api/health`, `GET /api/environment`, `OPTIONS` and
   `POST /api/dashboard/session`, `POST /api/pairing/exchange`, and
   `POST /api/webhooks/github` (HMAC-verified by its route).
3. `resolveDashboardCredential` returns a credential: pass when its scopes
   satisfy the route-scope table (see "Scopes"), else **403**
   `insufficient_scope`. This rule never falls back to peer trust. `GET
   /events/stream` also accepts its own `OVERDECK_EVENTS_TOKEN` bearer when that
   variable is set, so remote SSE consumers keep working.
4. The request is a trusted local caller (`isLoopbackPeer`, the same peer check
   as the mint): pass. With `require_token_mint`, a loopback peer that carries
   `X-Forwarded-For`, `X-Forwarded-Host` or `Forwarded` counts as remote.
5. Otherwise: **401** `{ "error": "unauthorized" }`.

The gate normalizes the path before deciding (query, absolute-form target,
percent escapes, repeated slashes, dot segments, case), because the router
matches `//api/x` to `/api/x`. Routes keep their own checks (Origin, CSRF,
internal-token-only routes); the gate adds a floor, it does not replace them.

`dashboard.require_token_mint` (boolean, default `false`) is read from raw
`~/.overdeck/config.yaml` by `src/lib/remote-access/config.ts` and cached until
a Settings save calls `invalidateRemoteAccessConfig()`, so the Settings toggle
(Access Tokens section) applies at once; a hand edit needs a restart.
`GET /api/settings` reports the enforced value.

## Webhook triggers and Tailscale Funnel

PAN-4648 adds webhook triggers (`src/lib/triggers/`, user docs
`configuration/triggers.mdx`). Two auth rules come with them.

**The hook route is outside the gate by path.** `POST /hooks/:id/:secret`
(`routes/trigger-hooks.ts`) is not under `/api/` or `/events/`, so rule 1 of the
remote request gate passes it with no credential and `REMOTE_GATE_ALLOWLIST`
does not change. The URL secret is the authorization: the route hashes it with
SHA-256 and compares it to the stored hash with `timingSafeEqual`, and an
unknown id and a wrong secret get the same `404`. The management routes
(`/api/triggers`, `routes/triggers.ts`) stay behind the gate at the default
`admin` scope.

**A Funnel request reaches only `POST /hooks/*`.** Tailscale Funnel proxies
public traffic to `127.0.0.1`, so with the default `require_token_mint: false` a
funneled request would look like the local operator. Every funneled request
carries `Tailscale-Funnel-Request: ?1`: tailscaled deletes any client-sent copy
and sets it (`ipn/ipnlocal/serve.go` `addTailscaleIdentityHeaders`), so the
header cannot be forged through Funnel. `isTailscaleFunnelRequest` in
`routes/dashboard-auth.ts` detects it, and:

- the remote request gate answers **404** `{ "error": "not found" }` to a Funnel
  request for any method or (normalized) path other than `POST /hooks/*`, before
  any credential check, and `isTrustedLocalRequest` is never true for one;
- the session mint (`rejectUnauthorizedDashboardSessionMintRequest`) never
  treats a Funnel request as a trusted peer;
- `authorizeDashboardUpgrade` answers **403** to a Funnel request before any
  other check, so no `/ws/*` socket opens.

The gate keys on the Funnel marker, never on `X-Forwarded-*`, because Traefik
and Tailscale Serve add those for legitimate local and tailnet visitors too.

## Threat model

**Defends:**
- LAN clients that can reach the dashboard's `0.0.0.0` API port. Before this
  gate, a GET upgrade with no `Origin` header passed origin validation
  outright, so any machine on the LAN got a live PTY on `/ws/terminal` by
  omitting the header — no browser, no credential.
- Non-browser clients that forge an `Origin` header the server would
  otherwise trust; the credential check still runs after origin validation.
- LAN clients calling `/api/*` or `/events/*` routes that check only
  `Origin`: the remote request gate answers them **401** unless they carry a
  credential (PAN-3762).
- A lost or stolen paired device: revoking it ends its HTTP access and its
  open connections at once, and the root internal token was never on it.
- A leaked access token: it reaches only the routes its scopes name, can never
  mint a session, a pairing credential or another token, and revoking it ends
  its access and open connections at once.
- LAN clients reaching the dashboard through Traefik with a forged `Host`
  header (PAN-4299). Traefik publishes 80/443/8080 on `127.0.0.1` by default
  (`traefik.bind` in `~/.overdeck/config.toml`), so other machines cannot
  connect. Even with `bind = "all"`, a Docker-bridge peer whose rightmost
  `X-Forwarded-For` entry is not loopback or a host Docker-bridge IP gets
  **401** from the session mint and from the remote request gate. With
  `bind = "all"`, Overdeck writes the 80, 443 and 8080 port lines with the
  explicit IPv4 host address `0.0.0.0`, which requests no IPv6 `[::]` listener
  for those ports. A port line you add without a host address
  publishes on IPv6 as well, and IPv6 clients on it reach Traefik through
  docker-proxy as the bridge gateway. A container created from a compose file
  older than PAN-4299 still publishes the managed ports on `[::]` until
  `pan restart --traefik` recreates it; `pan doctor` reports that as
  **Traefik port binding**.

**Does NOT defend:**
- Any process running on this machine. It can mint a session as a loopback
  peer with zero credentials, then use that cookie on every upgrade — this
  gate closes the LAN hole, not the local-machine trust boundary.
- Exposure through a local reverse proxy or tunnel while
  `dashboard.require_token_mint` is `false` (the default): the proxy connects
  from loopback, so every visitor is a trusted local caller. Turn the switch on
  whenever a proxy forwards outside traffic.

## Troubleshooting

The dashboard shows a destructive **"Dashboard session could not be
established (HTTP 401)"** banner (`data-phase="unauthorized"`) when
`ensureDashboardSession()` gets a 401 from any mint host — with the two-host
mint (PAN-3711), a 401 from either host is a failure (D-4), since a socket on
that host would otherwise fail regardless of the other host's mint. Two
distinct causes produce different symptoms:

- **Missing trusted-origin configuration** (`OVERDECK_TRAEFIK_*` /
  `OVERDECK_TRUSTED_ORIGINS` not set for this launch) — the *mint itself*
  403s on origin, which the frontend does not distinguish from an unreachable
  server, so it surfaces as `unreachable`/`delayed`, not `unauthorized`. Fix:
  correct the trusted-origin env for this launch path, or add the address
  from Settings → Anywhere (`~/.overdeck/trusted-origins.json`).
- **Non-loopback peer with no credential** — the mint's origin check passes
  but neither the internal token nor an existing session is present and the
  peer is not loopback/Docker-bridge/in-container, so the mint itself 401s →
  `unauthorized`. Fix: open the dashboard through `pan up` (its `#overdeck_token`
  hash bootstrap mints once with the internal token) or from a browser
  actually running on this machine.

## 2026-05 post-mortem

The PAN-457 cookie/session gate was removed from `/ws/terminal` and `/ws/rpc`
in 2026-05 (the `// Hotfix for #1166` comments this issue's work items
delete) because it broke every Traefik (`overdeck.localhost`) terminal. Three
root causes, two already fixed on `main` before this issue started:

1. The mint required the one-time `#overdeck_token` URL-hash token that only
   `pan up` injects, so any tab that was not freshly bootstrapped by `pan up`
   could never mint. **Fixed**: loopback and Docker-bridge peers now
   auto-mint with zero steps (`isLoopbackPeer`).
2. The session token was random per boot, so a dashboard restart invalidated
   every open tab's cookie. **Fixed**: the token is HMAC-derived from the
   persisted internal token, so it survives restarts
   (`dashboard-auth.test.ts`, "keeps a previously-minted session cookie valid
   across a restart").
3. The frontend silently swallowed a mint 401 (`if (response.status === 401)
   return null`), so a failed mint looked like an ordinary connection issue
   and nobody diagnosed it as an auth failure. **Fixed by this issue**:
   `ensureDashboardSession()` now throws `DashboardSessionUnauthorizedError`
   on a 401, and the dashboard shows the `unauthorized` phase loudly instead
   of failing silently.
