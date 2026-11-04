# Overdeck Anywhere: machine links, the secure channel and routes

PAN-4645 is the foundation of Overdeck Anywhere (PRD `.pan/drafts/pan-2350.md`,
revision 5; issue PRD `.pan/drafts/PAN-4645.md`): two machines that each run their
own Overdeck link their dashboards server to server over an end-to-end encrypted
channel, learn how to reach each other, and watch each other's health. Sibling
issues build the conversation views, the relay and the desktop flows on top of
these pieces. User-facing pages: `configuration/linked-machines.mdx` and
`cli/machines.mdx`. PAN-2356 adds the overdeck.ai directory, `direct` and `relay`
routes, two-screen approval and the webhook inbox (sections below; the Worker is
`docs/CONNECT-SERVICE.md`).

## Running the two-machine smoke

AC-1 of the release criteria runs in CI as
`tests/integration/anywhere/two-machine-ac1.slow.test.ts` (the `test-e2e` job, PAN-4774): two
peer dashboards on free ports with a fake `claude`. The full smoke below stays a script (it binds
two LAN-visible ports and needs a built tree). The whole release run, AC-1 to AC-15, is in the
[release checklist](ANYWHERE-RELEASE-CHECKLIST.md).

```bash
npm run build
node scripts/anywhere/two-machine-smoke.mjs
```

It starts two `dist/dashboard/server.js` processes with `OVERDECK_HOME` set to
`.tmp/anywhere-a` (port 3041) and `.tmp/anywhere-b` (port 3042), both in peer mode
(`OVERDECK_DISABLE_DEACON=1`, so no Deacon, tracker polling or proxy watchdog) with
the link supervisor opted back in (`OVERDECK_ANYWHERE_SUPERVISOR=1`). Then, step by
step, each named in the output:

| Step | What it asserts |
| --- | --- |
| `fake-clis` | fresh homes, each with a fake `HOME`, a fake npm prefix holding fake `claude` 2.1.0 and `codex` 0.150.0, and a fake `npm` (B's prefix also holds a `docker` that exits 1); the servers run on a hard link to Node in `.tmp/anywhere-node/bin` (see below) |
| `start` | both servers answer `GET /api/environment` within 90 s |
| `proxy` | a byte-logging TCP proxy on a free loopback port fronts B |
| `pair+link` | `pan pair --url http://127.0.0.1:<proxy> --json` on B, `pan machines link <url> --allow-loopback --json` on A; B holds the reverse link |
| `online` | both `pan machines list --json` show the other online within 15 s, and A's current route is the proxy (the pairing route outranks B's advertised LAN routes by source order) |
| `versions` | `pan machines versions --json` on A shows two rows with claude 2.1.0 and codex 0.150.0; unless each row lists exactly claude and codex with update commands inside `.tmp/anywhere-`, the script stops before Update all |
| `update-all` | `pan machines update --json` on A; within 60 s both rows are `done` with claude `2.1.0 → 2.1.5` and codex `0.150.0 → 0.159.0`, Overdeck skipped (development install) |
| `seed` | (#4650) B gets a local conversation with a >2 MiB transcript, an image and a vault index entry; A gets a saved copy of it |
| `list` | A's `GET /api/conversations` lists `@<B>/<name>` once, carrying the saved copy |
| `open-budget` | opening it through A moves at most 1,114,112 bytes B to A |
| `image` | its attachment through A matches B's bytes |
| `tell-once` | a repeated `pan tell … --message-id` replays the first answer; the same id with other text is refused (the seeded conversation has no live pane, so that answer is a failed delivery; `remote-reply` checks delivery) |
| `released-409` | with `released_to` set on B, a message through A answers 409 `conversation-released` |
| `forward` | `pan machines forward` reaches a dev server on B; B's dashboard port is refused |
| `needs-docker` | (#4774) B carries no `docker` tag; `POST /api/fleet/placement` on A with `needs: ['docker']` picks A, and `pan lane start --machine auto --needs docker --json` on A launches the lane on A, which is then stopped and reaped. Skipped, with a logged reason, when this host's `docker info` fails |
| `lane-remote` | (#4638) `pan lane start --role play --machine <B> --json` on A, under a root conversation on A, answers with B as the machine and a null id (B's `projects.yaml` puts the lanes root under B's fake `HOME`) |
| `lane-report` | `pan lane report --status done` inside the lane on B; `pan lane wait <name>` on A exits 0 with the body within 20 s, and `pan lane list --json` on A lists the lane on B |
| `lane-nest` | A's `GET /api/conversations` lists `@<B>/<name>` with A's root conversation id as `parentConversationId` and `gauntletRun` `smoke` |
| `lane-reap` | `pan lane stop` then `pan lane reap` on A exit 0; B's row is archived and A's stand-in has `archived.json` |
| `kill B` | after `SIGKILL`, A shows the link offline within 30 s |
| `restart B` | A shows it online again within 60 s |
| `no-http` | the proxy capture starts with the channel preamble byte `0x00` and contains no `HTTP/1.1` |
| `hold` | (`--hold`, #4774) keeps both servers and B's dev server up, prints the `HOLD` line and waits for `SIGINT` or `SIGTERM` |
| `stop` | both servers stopped; nothing outside `.tmp/anywhere-a|b` touched |

The servers run with `HOME=<home>/fakehome`, `PATH=<home>/npm/bin:/usr/local/bin:/usr/bin:/bin`
and no `SHELL`, because the harness-binary resolver also searches home directories and a
login shell. They also run on a hard link to the Node binary in an otherwise empty
directory: the dashboard puts its own Node's directory first on `PATH`
(`src/dashboard/server/path-env.ts`), and an nvm or npm-global bin directory also holds
the operator's real CLIs, which Update all would otherwise update.

Exit 0 on success, exit 1 with `FAILED at step <name>: <why>` otherwise.
`--live-claude` adds `remote-reply` (a real Claude conversation on B answers a message
sent from A) and `pull` (`pan conv pull` brings it, with an uncommitted change, to A, and
B then answers 409 `conversation-released`); its harnesses run on the smoke homes' own
tmux sockets. It keeps the real `HOME` and `PATH` (Claude Code needs its login and
binary), so it skips `versions` and `update-all`.
`--inject-plain-http` sends one plain request through the proxy so the detector's
failure path can be checked (it then fails at `no-http`).
`--hold` keeps the pair for browser checks (PAN-4774): after `no-http` it restarts B if
it is down, keeps B's `forward` dev server (`hello from b`) running, prints
`HOLD a=http://127.0.0.1:3041 b=http://127.0.0.1:3042 dev=<port> conversation=@<B>/smoke-desk`,
and cleans up on `SIGINT` or `SIGTERM` (exit 0). The servers always start through
`.tmp/anywhere-node/serve.js`, a symlink to `dist/dashboard/server.js`, because the host's
orphan reaper matches `dist/dashboard/server.js` in a command line and would kill a held
server after 120 s. The work agent runs the
script before `pan done` and pastes the output into the PR description.

## Running the directory smoke

The live check for the directory (PAN-2356) is `scripts/anywhere/directory-smoke.mjs`, also
run by hand after a build:

```bash
npm run build
node scripts/anywhere/directory-smoke.mjs
```

It bundles `services/connect` with `wrangler deploy --dry-run` and runs it in Miniflare on a
free loopback port (state in `.tmp/directory-smoke/state`), with an inline `AccountRpc` stub:
two `tester` device tokens and four `free` ones, and no TURN secrets, so relay requests answer
`turn_unavailable`. It starts dashboards A (port 3051, `.tmp/directory-a`) and B (port 3052,
`.tmp/directory-b`) in peer mode with `anywhere.directory_url` pointing at it and
`OVERDECK_ANYWHERE_NO_ADVERTISE=1`, so the only route between them is `direct`.

| Step | What it asserts |
| --- | --- |
| `connect` | the directory answers `/healthz` |
| `start` | both dashboards answer `GET /api/environment` |
| `register` | both `pan machines directory --json` show `online` and list both machines |
| `approve` | B runs `pan machines join --to <A>`, A runs `pan machines approve <id> --yes`; both print the same code; B accepts; both links are online over `rtc://` within 60 s |
| `limit` | four `free` sockets: the fourth gets "The free account includes 3 machines" and close 4009 |
| `inbox` | B adds an inbox trigger and stops; a POSTed marker body gets 202 and appears in no storage file; after B restarts it runs the event through the trigger core and the Worker logs `inbox-ack` |
| `logs` | no Worker log line carries the marker or SDP text |
| `stop` | the directory and both dashboards stopped; nothing outside `.tmp/` touched |

Exit 0 on success, exit 1 with `FAILED at step <name>: <why>` otherwise.

## Server to server, over a secure channel (D-1, D-2 of pan-2350)

A browser only ever talks to its own machine's dashboard. That dashboard holds the
links and talks to the other machine's dashboard; the browser page is same-origin
by construction and holds no keys. The channel between two dashboards is a Noise
protocol session over a byte stream. Every HTTP request and every WebSocket upgrade
that crosses a link runs inside it, on every route: there is no unencrypted traffic
between machines.

Each dashboard owns one long-term X25519 machine key, `~/.overdeck/machine-key.json`
(mode 0600, `src/lib/anywhere/machine-key.ts`), created on first start. Its public
half is in the environment descriptor (`GET /api/environment`: `machineKey`,
`linkProtocol`, `endpoints`, `capabilities.machineLinks`). The fingerprint shown in
the UI and the CLI is five dash-separated groups of four hex characters.

## Library and handshakes (D-4645-1, D-4645-2)

`noise-handshake@4.2.0` (Holepunch) runs the handshake, `@hyperswarm/secret-stream@6.9.2`
carries the stream. Both are pinned exactly and stay external to the server bundles (tsdown
`neverBundle`) because they reach `sodium-native` prebuilt binaries; the protocol code imports
them with static ESM imports from `packages/anywhere-channel/src/noise.ts` (PAN-4833). Hashing
and randomness go through a crypto port passed as an argument (`nodeCrypto` on the server,
`webCrypto` on the phone), so the same source runs on both. Two patterns:

- **IK** for a link whose peer key is pinned: the initiator (`openChannel` in
  `src/lib/anywhere/channel/open.ts`, which runs `runInitiatorHandshake` from
  `packages/anywhere-channel/src/initiator.ts`) proves its own key and names the responder's in
  message 1; the responder (`acceptChannel`, `accept.ts`) accepts only a key that an
  active `machine` token is bound to (refusal `01` otherwise).
- **XXpsk0** for pairing: both sides mix in a pre-shared key derived from the pairing
  code (D-4645-17): `psk = SHA-256("overdeck-pair-psk/1" || 0x00 || code)` and
  `pairingId = first 16 bytes of SHA-256("overdeck-pair-id/1" || 0x00 || code)`. The
  responder looks the pairing id up in its live `pan pair` credentials and consumes it
  on success.

- **XX** for an approval (PAN-2356, see "Approval"): no pre-shared key and no pinned key; the
  two operators authenticate the exchange by comparing the six-digit SAS. `noise-handshake@4.2.0`
  accepts the plain `XX` pattern, so the PRD's `XXpsk0` fallback was not needed.

The Noise prologue binds the mode and the pairing id (or approval request id): `overdeck-link/1\0<mode byte>\0<pairing id or request id hex, or empty>`.

## Wire format (D-4645-5)

`packages/anywhere-channel/src/wire.ts` encodes and parses everything below, and the phone app
runs the same file. The same bytes travel over raw TCP (`tcp://host:port`, routes `lan`, `tailnet`,
`public`), as the binary payload of a `/ws/link` WebSocket (`wss://host/ws/link`), and over a
WebRTC data channel (`rtc://<environment id>`, `rtc+turn://<environment id>`; PAN-2356).

1. The initiator sends the preamble `00 4F 56 44 4C <linkProtocol=01> <mode>`; mode
   `01` is link (IK), `02` is pairing (XXpsk0), `03` is approval (XX, PAN-2356); pairing
   appends the 16-byte pairing id and approval the 16-byte approval request id. Approval mode
   then exchanges three more frames after message 3: A's nonce commitment, R's nonce and A's
   nonce (see "Approval").
2. Handshake messages travel as `uint24le length` + message, at most 1024 bytes. A frame
   of length 0 followed by one code byte is a refusal: `01` unknown peer key, `02`
   unsupported link protocol (then a `uint8` responder protocol and a length-prefixed
   UTF-8 server version), `03` unknown or expired pairing id (or, in approval mode, no live
   approval request with that id), `04` busy (the responder has 32 handshakes pending).
3. After the last handshake message both ends build the `SecretStream` synchronously in
   the same tick; leftover bytes are handed to the stream.

`ChannelSocket` (`channel-socket.ts`) wraps the stream as a Node `Duplex` that the HTTP
stack treats as a socket. Its `channel` marker carries `{ mode, remoteKeyHex, pairingId }`
and its `remoteAddress` is `link:<first 16 hex of the remote key>`, so every channel
request counts as remote (D-4645-10): never a loopback peer, never a trusted local caller.

### Phone side (PAN-4833, PAN-4834)

The phone app imports the same protocol from `@overdeck/anywhere-channel/web`:
`openSecureChannel` runs the shared initiator sequence (link and pairing only) on the web crypto
port and pure-JS libsodium; `RtcDuplexWeb` wraps a browser `RTCDataChannel` with the server's
limits (16 KiB messages, back-pressure above 1 MiB); `DirectoryWebClient` is the client-role
directory socket (`hello-client`, token in the `overdeck.bearer.<token>` subprotocol); it also
serves `node` connector clients (`pan mcp connector`, PAN-4927 D-18), not just phones; and
`createMachineDialer` opens `ovdl` channels to a machine. Because a machine closes an older
peer connection when a new offer arrives for the same peer, the dialer keeps one peer connection
per (machine, relay) and opens one more data channel on it per dial. No server file imports
`./web`. CP-1 timings are in `packages/anywhere-channel/CP-1.md`.

The phone has no `http.Agent`, so `createChannelPool` and `ChannelWebSocket` speak HTTP/1.1 and
RFC 6455 over channel streams themselves. The pool follows the same rules as `LinkAgent`: at
most 4 channels per machine, a 4 s idle close, and one resend of a safe request that died on a
stale channel. `installChannelShims` replaces `fetch` and `WebSocket`, so the unchanged
frontend's `/api/*` and `/ws/rpc` traffic reaches the current machine with the phone token.
Other URLs, such as the directory, keep the original implementations. The clients and shims are
tested against `installChannelListener` in `tests/integration/anywhere/phone-channel.test.ts`;
the package README has the details and the CP-2 direct-URL audit.

A failed link is logged on the phone (PAN-5018): `[overdeck] link <label>: direct dial failed: …`,
`relay dial failed: …`, and `secure open failed over <direct|relay> (<code>): …` with the
`ChannelOpenError` code. A secure open that fails with `timeout` or `protocol` means a raw channel
opened but the handshake got no valid reply, so the peer connection under it is suspect: the phone
closes that one peer connection, if it is still the current one for the machine, and forgets the
remembered route; its other connections to the machine stay open (PAN-5046). Closing a peer
connection ends every raw channel the dialer handed out on it at once, because
`RTCPeerConnection.close()` fires no `close` on its data channels: an open stream closes and a
handshake still running fails as `unreachable` instead of waiting out its 10 s timeout. A
connection that turns `disconnected` (a network change) is kept; after 2 s still disconnected the
dialer sends an ICE-restart offer on the same session, which the machine answers on the existing
peer connection, so open channels survive. Only a restart that is not connected 10 s after its
offer, or a `failed` connection, makes the next dial send a fresh offer. When the open machine's
link comes back and the machine view's stream is not live, the shell reconnects that stream at once
(`installLinkRecovery`), so held composer messages send. Definitive refusals (`unknown-peer`, `pairing-refused`, `identity-refused`,
`unsupported`) and `busy` keep the connection. A web bundle built with
`VITE_OVERDECK_DEBUG_ERRORS=1` appends the code to the on-screen text, for example
"Could not open a secure channel to desk. (timeout)".

Opening a machine reloads the page and a resume reconnects the directory socket, so a dial waits up
to 10 s for an off or connecting socket before it reports "Not connected to overdeck.ai."
(`DIRECTORY_WAIT_MS`). The shell's failure text over the machine view clears on the next dial that
succeeds; before PAN-5018 one failed dial kept its text on screen while later dials worked.

## One session per connection; the same port (D-4645-3, D-4645-4)

Every transport connection is one Noise session with a one-round-trip IK handshake; there
is no multiplexer. HTTP keep-alive pools amortise the handshake: each channel gets one
`http.Agent` (`src/lib/anywhere/channel/channel-agent.ts`, `maxSockets: 1`) that every
channel HTTP client uses, and `LinkAgent` (`src/lib/anywhere/link-client.ts`) pools up to
four channels per linked machine for `linkFetch`. A plain `http.request` with only
`createConnection` would send `Connection: close` and the peer would end the channel after
the first answer, which is exactly what the first smoke run hit.

A pooled channel does not sit idle forever: `LinkAgent` gives every channel a
`LINK_POOL_IDLE_MS` (4 s) idle timeout, and a shorter `Keep-Alive` hint from the linked
machine lowers it further. This matters behind the Fly WebSocket proxy, where the linked
machine's own HTTP server closes an idle channel after 5 s and home does not always see
that close before reusing it; without a pool-side timeout the next request over the dead
channel failed with `socket hang up` (PAN-4740). Even so, the far end can close a channel
in the narrow window between the pool handing it out and the request reaching the wire, so
`linkFetch` and `linkForward` resend a `GET`, `HEAD` or `OPTIONS` request once, on a fresh
channel, when it dies with `ECONNRESET` or `EPIPE` on a reused channel before any response
byte arrives. Every other method, and any request that already got a response, is never
resent.

Opening a channel to a link has two budgets. A `connecting` link gets `LINK_WAIT_MS` (2.5 s) to come
online, and an `offline`, `revoked` or `unsupported` link fails at once. The open itself (transport
connect plus handshake) to an online link gets `LINK_OPEN_MS` (10 s): over the public Fly route, TLS to
the edge, the `fly-force-instance-id` pin and the handshake missed 2.5 s often enough that two of three
worker starts failed against an online link (PAN-4885). Callers that need a shorter bound pass their own
signal; fleet search and usage keep 2.5 s per machine that way.

No new port is opened. `installChannelListener` (`src/dashboard/server/channel-listener.ts`)
is installed in the `NodeHttpServer.make` factory and reads the first byte of every
connection on the dashboard port: `0x00` is a channel, anything else goes to the HTTP
parser untouched. Each accepted channel is handed to the same HTTP server as a connection,
so every route, `/ws/rpc` and `/ws/terminal` work across a link unchanged. `/ws/link` is the
WebSocket form of the same thing and the only upgrade that happens before authentication;
the channel's own handshake is the authentication. A connection that sends no first byte
within 10 s is dropped.

The listener and the link supervisor run only where `hostsMachineLinks()`
(`src/lib/boot-gates.ts`) is true: the primary dashboard, or a peer-mode dashboard
(`OVERDECK_DISABLE_DEACON=1`) that sets `OVERDECK_ANYWHERE_SUPERVISOR=1` (D-4645-21). The
link-store snapshot refresh runs on every dashboard. Boot is one module,
`src/dashboard/server/services/anywhere-boot.ts`.

## Routes (D-10 of pan-2350)

A link holds a list of routes to the other machine (`src/lib/anywhere/routes.ts`,
persisted in `~/.overdeck/machine-links.json`, mode 0600). Each route has a kind, ranked
best to worst `lan < tailnet < ssh < public < direct < relay`, and a source, ranked
`manual < pairing < advertised`; `tcp` beats `wss` at equal rank. Where a route came from:

- **pairing**: the address in the pairing link (`http://host:port/#pair=…` becomes
  `tcp://host:port`; `https://host` becomes `wss://host/ws/link`). A loopback pairing link
  is refused unless `--allow-loopback` (both servers on one host).
- **advertised**: the endpoints the other machine lists in its descriptor
  (`src/lib/anywhere/endpoints.ts`): `lan` for non-internal RFC 1918 IPv4 on real interfaces
  (container bridges and `tailscale*` skipped), `tailnet` for `100.64.0.0/10`, and the
  Tailscale Serve name as `wss://<name>/ws/link` when `tailscale status --json` names this
  machine and `https://<name>/api/environment` answers with our environment id. Discovery is
  cached and refreshed every 10 min; `endpointsHash` (first 16 hex of SHA-256 over the sorted
  URLs) rides in every heartbeat so a peer refetches the descriptor only when something
  changed. Advertised routes the peer no longer lists are dropped; pairing and manual routes stay.
- **manual**: `POST /api/machines/:id/routes { url }` (Settings → Machines → Add route).

## The link supervisor (D-4645-6, D-4645-7, D-4645-8)

`src/dashboard/server/services/link-supervisor.ts` keeps one channel per link on the best
route that answers. States: `connecting`, `online`, `offline`, `unsupported`, `revoked`.

- **Probing**: every route is tried in parallel with a 2.5 s timeout; the first success in
  rank order wins and the losers are closed. Through the new channel it reads the
  descriptor (which must name the link's environment id, support `machineLinks` at our
  protocol, and advertise the key the handshake proved) and opens the heartbeat stream
  `GET /api/machines/heartbeat` (SSE, machine credential only).
- **Heartbeats** arrive every 15 s with `{ seq, lastStall, endpointsHash, serverVersion }`.
  Late at 17.5 s: `connecting`, fresh probes, the old channel kept. Nothing by 20 s:
  `offline`, channel closed. So an unplugged machine is noticed in 5 to 20 s.
- **Back-off**: 1 s doubling to a 45 s cap with ±20 % jitter for network failures; a route
  that closes the connection before proving its key on every route (a key mismatch) backs
  off to a 300 s cap. Every 60 s a link that is not on its best route probes the better ones.
- **Incidents** (D-4645-8): the heartbeat carries `lastStall: { durationMs, endedAgoMs }`
  from the dashboard's event-loop stall probe (`event-loop-monitor.ts`: a 250 ms probe,
  stalls of 1 s or more recorded, 2 s or more pushed at once). Clocks differ between
  machines, so the receiver computes `stallEnd = receivedAt - endedAgoMs`. A late heartbeat
  whose stall of 2 s or more ended inside the gap is recorded as incident `froze`; any other
  gap is `network`.
- **Refusals**: refusal `01` on any route marks the link `revoked` (the peer no longer holds
  our token) and probing stops until `Reconnect`. A peer without `machineLinks` or with
  another link protocol is `unsupported` with the version to install.
  `unsupportedInstall()` decides which version and where, for both the descriptor check
  and handshake refusal `02`: the peer's version on this machine when the peer speaks a
  newer link protocol, this machine's version on the peer otherwise. The state detail ends
  with `npm install -g @overdeck/core@<version>` (`overdeckInstallCommand`), and
  `status().unsupported` carries the structured value for the fleet table (PAN-4654).

## Machine credentials and fencing (D-4645-9, D-4645-10, FR-4)

Linking mints a `machine` access token (`kind: 'machine'`, `src/lib/access-tokens.ts`) on the
machine being linked and gives it to the linking machine through the pairing channel
(`POST /api/machines/exchange`). **Link both ways** mints the mirror token in the same
exchange. A `machine` record resolves (`resolveDashboardCredential(headers, channel)`) only
inside a link channel whose proved key is the record's `machineKey`; the same token over
plain HTTP is nothing (D-4645-9). Scopes (`MACHINE_TOKEN_SCOPES`): `read:events`,
`read:state`, `read:conversations`, `read:costs`, `read:settings`, `tell`, `operate`, plus
`forward` for operator-level links. Neither level can pair devices, mint tokens or change
settings; a channel request to those routes is refused at the gate. An agent-fenced link's
forwarded requests carry `x-overdeck-link-actor: agent:<id>` and a scope ceiling
(`x-overdeck-link-ceiling`) and are never operator-level.

Any remote access (a trusted remote address, a paired device, a machine link or token)
turns `require_token_mint` on by itself; YAML `false` cannot turn it off while remote access
exists (D-4645-12). A plain-HTTP browser on another device gets the "Use HTTPS" page (D-4645-13).

## Phone credentials (PAN-4835)

The phone app's machine-side identity is a `kind: 'phone'` access-token
record, minted by `POST /api/phones/exchange` and bound to the phone's link
key the same way a `machine` record is bound to `machineKey`. Full detail —
the record fields, `PHONE_TOKEN_SCOPES`, the two self-service routes,
revocation and the device list — lives in `docs/DASHBOARD-AUTH.md` under
"Phone credentials (PAN-4835)". The one fact that belongs here: the link-mode
handshake's `isPinnedPeer` (`server.ts`) accepts a key held by either an
active `machine` record or an active `phone` record
(`findActiveChannelTokenByKey`), so a phone's handshake reaches HTTP the same
way a linked machine's does.

## Connector credentials (PAN-4927 W-CONN1)

An Overdeck connector (the process a self-hosted bot runs) pairs once with one
machine and then reaches it through a link-mode channel. Full detail — the
`kind: 'connector'` record, its scopes, the routes and the cross-refusal —
lives in `docs/DASHBOARD-AUTH.md` under "Connector credentials (PAN-4927
W-CONN1)". The facts that belong here:

- **Pairing string.** "Connect a bot" shows
  `overdeck-connector:/pair#v=1&e=<environmentId>&k=<machineKeyHex>&c=<odp_code>`.
  `packages/contracts/src/connector-pairing.ts` builds and parses it, next to
  the phone link; the two formats never parse as each other.
- **Intent store.** The code is an ordinary `odp_` pairing code. Its intent
  (`{ name, scopes, expiresAt }`) is kept in memory by the code's pairingId
  (`src/dashboard/server/connector-pairing.ts`), so the pairing channel's
  marker is enough for the exchange to find it. A dashboard restart drops
  intents and codes together.
- **Handshake pin.** `isPinnedPeer` (`server.ts`) accepts a key held by an
  active `machine`, `phone` or `connector` record
  (`findActiveChannelTokenByKey`).
- **One machine only.** The three fleet spawn routes (`POST
  /api/fleet/conversations`, `/api/fleet/workers`,
  `/api/fleet/issues/:id/start`) admit a connector through its link channel
  for a target on this machine only and answer 403 `connector-local-only` for
  any other target, before any side effect (PAN-4950 D-5). Placement, worker
  stop, the fleet reads and the linked-conversation proxy still refuse every
  channel caller, so a connector reaches only the machine it paired with.

## The connector process (PAN-4927 W-CONN2)

`pan mcp connector login|pair|serve|status|logout` (PAN-4950) is the process a
self-hosted bot runs. The CLI group is `src/cli/commands/mcp-connector.ts`
(type-only at load; each action imports its module); the modules live in
`src/lib/mcp/connector/` and import nothing from `src/dashboard/`:

- `home.ts` — the connector home, `$OVERDECK_CONNECTOR_HOME` (default
  `~/.overdeck-connector`, 0700) with `account.json`, `identity.json`,
  `pairing.json` and `local-token` (0600, written atomically). It never reads
  or writes `~/.overdeck`; in particular the connector never uses
  `ensureMachineKey` or `readDirectoryUrl`.
- `account.ts` — `login` (the overdeck.ai device flow with
  `environment_id` = the connector's `clientId`) and `status`.
- `directory.ts` — `DirectoryWebClient` in the client role with
  `platform: 'node'`: the account token rides in the `overdeck.bearer.<token>`
  subprotocol, `hello-client.publicKeyHex` is the home's install key (not a
  push key), and the client id is the home's `clientId`.
- `dial.ts` — an `RtcTransport` whose signalling port is that directory
  socket (`signal` frames with purpose `link`, `ice-servers` requests),
  registered with `setRtcDialer`. It only dials. Relay channels are metered
  like the phone's (`relay-usage` every 60 s and on close, at most 1e9 bytes
  per frame), because the directory counts only the initiator's reports; a
  `relay-status` with `stopped: true` closes them and refuses new relay dials.
- `channel-api.ts` — `ConnectorLink`, a `LinkRouteSource`, and the tools'
  `DashboardApi` over `linkFetch(environmentId, path, { routeSource })`, so
  the connector reuses `LinkAgent`'s pool. `openLinkSocket` bounds a dial at
  `LINK_WAIT_MS` (2.5 s), which a cold ICE negotiation through TURN can
  exceed, so the link reports `online` only after a probe channel (15 s
  timeout, then closed) has set up the peer connection; later dials reuse it.
  Each later probe first closes the transport entry. Direct first, relay only
  when allowed; failed rounds back off 1 s doubling to 60 s.
- `pair.ts` — `pair` (a pairing-mode channel with the `odp_` code and a fresh
  link key, then `POST /api/connectors/exchange`; the proven key and the
  descriptor's `machineKey` must both equal the string's `k`) and `logout`.
- `serve.ts` — `127.0.0.1:7466` `POST /mcp` (stateless, local-token bearer,
  constant-time compare) or stdio, with the shared tool module minus
  `list_machines` and with the start tools' `machine`/`needs` removed.

## Phone Live Activity (PAN-4839)

The only phone data that leaves the secure channel in plain text is the two
Live Activity counts (OD-1): how many items need the operator and how many
agents are running. iOS draws the card from an APNs push with no app code in
between, so the push cannot be sealed the way needs-you notifications are.

The flow: the primary dashboard's `live-activity-service.ts` reads this
machine's counts every 5 s (the Needs-You feed, and agents in the dashboard
pill's running set) and `src/lib/push/live-activity-sender.ts` sends
`push-activity { to, needsYou, running }` to the directory for each paired
phone, on a change at most every 15 s and otherwise every 5 minutes. The
directory sums the fresh reports of all machines for that phone and pushes
the sum to APNs (`docs/CONNECT-SERVICE.md`, "Live Activity (PAN-4839)"). The
phone registers its activity push token with `activity-register` when the app
comes to the foreground. Linked machines' rows are not counted: each machine
reports only its own.

## `/ws/rpc` restricted group (D-4645-14, D-4645-15)

RPC middleware sees per-message headers, not the upgrade, so the group is chosen at upgrade
time (`ws-rpc-auth.ts`): an admin credential gets the full `PanRpcGroup`; a machine, phone,
device or token credential gets the group with every tag omitted whose `RPC_METHOD_SCOPES`
entry is outside the credential's scopes — PAN-4835 added `pan.getSnapshot` (`read:state`) and
`pan.replayEvents` (`read:events`), the boot calls every dashboard client makes. Revoking the
credential closes its sockets with code 4401, the raw socket found through the request's
`IncomingMessage`, for `net.Socket` and `ChannelSocket` alike.

## Directory and direct connections (D-3)

PAN-2356 adds the overdeck.ai directory (`services/connect`, `docs/CONNECT-SERVICE.md`): one
Cloudflare Durable Object per account that knows the account's machines and introduces them.

- **Directory client** (`src/dashboard/server/services/directory-client.ts`): on the primary
  dashboard of a signed-in machine (`account.json`), one WebSocket to
  `<anywhere.directory_url>/v1/directory` (read raw from `config.yaml` by
  `src/lib/anywhere/directory-config.ts`; `https:`, or `http:` to loopback). It sends `hello`
  (environment id, label, machine key, advertised endpoints), keeps the account's machine list,
  pings every 30 s, reconnects with 1 s → 300 s back-off, and stops on a refusal (401/403,
  closes 4001/4003/4009/4010/4011/4012) until `account.json` changes. A signed-out machine
  opens nothing. `GET /api/directory` returns its `status()`.
- **WebRTC transport** (`src/lib/anywhere/channel/rtc-transport.ts`, `rtc-duplex.ts`, werift
  0.25.1, bundled): one peer connection per (peer, relay, purpose), shared by every dial; each
  dial opens an ordered `ovdl` data channel wrapped as a `Duplex` (16 KiB messages, backpressure
  above 1 MiB). werift reads a single TURN URL per peer connection, so the relay route orders its
  list first (see "Relay and metering" below). Either side may open channels on an existing connection, so both accept them.
  The offer, answer and ICE candidates ride the directory socket as `signal` frames; the
  Durable Object stamps `from` from the sender's socket.
- **Routes** (`directory-rtc.ts`, `directory-routes.ts`): `rtc://<id>` (kind `direct`) and
  `rtc+turn://<id>` (kind `relay`) are transport URLs `openChannel` hands to the registered
  dialer; incoming data channels run the channel listener's handshake (`acceptRawChannel`).
  The supervisor gets them from `dynamicRoutes(link)` only while the directory lists the peer
  online with the pinned key, with source `directory`; they are never written to
  `machine-links.json` (`mergeAdvertised` and **Add route** refuse them), because an older
  `pan` would reject the whole file.
- **Phased probing** (D-2356-8, `link-supervisor.ts`): stored-kind routes at 2.5 s; `direct`
  at 10 s only if that found no channel and no `unknown-peer`; `relay` at 10 s last. With no
  relay plan the detail is "No direct path; install Tailscale or use the relay plan".
- `OVERDECK_ANYWHERE_NO_ADVERTISE=1` makes a dashboard advertise no endpoints (the directory
  smoke uses it so only `direct` can link two dashboards on one host). `OVERDECK_PUBLIC_LINK_ONLY=1`
  has the same effect (PAN-4741).

### Diagnosing a link that does not open (PAN-5018)

Every layer of a direct or relayed link writes `[anywhere]` lines to `dashboard.log`. Ids are cut
to 8 characters; no line carries SDP, ICE candidate text, keys, tokens or pairing codes. These
lines are always on, because they are bounded by real events:

- `rtc offer from <from> session <session> (<purpose>, <direct|relay>)`: an offer reached
  `RtcTransport`. Its outcome follows: `rtc session <session> answered`,
  `rtc offer dropped: <reason>` (the session belongs to another peer, is closed, or is already
  open), or `rtc session <session> from <from> failed at <step>: <message>`, where the step is
  `ice-servers`, `peer-connection`, `remote-description` or `answer`.
- `rtc session <session> ice restart from <from>`: an offer on a session that is already open, from
  the same peer, is an ICE restart (PAN-5046). The machine renegotiates that peer connection and logs
  `rtc session <session> answered`; open data channels survive.
- `rtc closing session <session> for <from>: a new offer replaced it`. Many of these for one peer in a
  few minutes mean that peer kept building new connections instead of restarting ICE on the one it
  had (before PAN-5046 the phone did this after every network change).
- `rtc session <session> <peer> connected|failed|closed`: a peer connection changed state.
- `directory online (plan <plan>, <n> machines)`, `directory socket closed (<code>)`,
  `directory refused: <message>` (for example close 4011, "Another Overdeck process registered
  this machine with the directory"), `directory upgrade refused (<status>)`,
  `directory silent for <s> s; reconnecting` and `directory account changed; reconnecting`.
- `channel refused (<code>, <mode>): <message>` for every secure-channel refusal except `closed`
  and `timeout`. `<mode>` is `link`, `pairing`, `approval`, or `unknown` before the preamble.
  `channel refused (unknown-peer, link)` whose initiator key is a linked machine's own key is
  expected while that machine re-links: between the removal of its old link and the new one, its
  dials home are refused.

`OVERDECK_ANYWHERE_DEBUG=1` in the dashboard's environment adds the routine lines:
`rtc candidate dropped: …`, `rtc answer dropped: …`,
`directory signal from <from> session <session> (offer|answer|candidate)`,
`directory message on a replaced socket ignored`, and the `closed` and `timeout` channel
refusals, which the supervisor's phased probing causes whenever it aborts a losing channel. The
helper is `src/lib/anywhere/debug-log.ts`.

`acceptChannel` errors carry the handshake mode once the preamble is parsed (`null` before). An
unexpected exception inside the handshake has the code `internal`, not `closed`, so a bug in the
responder is always logged instead of looking like a peer that went away.

## Approval (D-2356-9/10)

Linking two machines of one account with no pairing code, confirmed on both screens
(`directory-approval.ts`, routes in `routes/directory-approval.ts`):

1. The requester R sends `approval-request` through the directory (`POST /api/directory/join`).
2. The approver A opens it: A dials R over `direct` with purpose `approval` and runs an
   approval-mode channel (mode `03`, Noise XX, the request id in the preamble). R's listener
   accepts it once, only for R's own live request id (`takeApproval`). A refuses a channel
   whose key differs from the one the request named.
3. Commit-then-reveal, then the SAS (D-2356-10 as amended after review). After message 3,
   A sends `C = SHA-256("overdeck-approve-commit/1" || 0x00 || handshakeHash || n_A)` for a
   fresh 32-byte nonce, R answers with its own 32-byte nonce `n_R`, and A reveals `n_A`; R
   refuses the channel unless `C` matches. Both then show
   `uint32BE(SHA-256("overdeck-approve-sas/2" || 0x00 || handshakeHash || n_A || n_R)[0..4]) mod 1_000_000`
   as `123 456`, with the other machine's fingerprint from the handshake key, never from the
   directory. A man in the middle runs two legs; on each it fixes its input before it can know
   the code that input gives (it answers A before A reveals, and commits to R before `n_R`
   arrives), so it cannot grind the two codes to match. One channel per request id stops it
   from restarting the R leg for a new nonce. The commit-then-reveal is needed because six
   digits collide after about 10^6 tries: without it an attacker can vary its own leg (for
   example its message-3 static key) until the codes match.
4. A's operator approves and R's accepts. A mints its machine token for R and posts
   `POST /api/machines/approval-exchange` over the approval channel (the request gate admits
   only that and `GET /api/environment` on an approval channel, and refuses the exchange on
   every other socket). R answers `202` until its operator decides, then mints its token for
   A through `grantMachineLink` (shared with the pairing exchange) and stores its link back;
   A stores its link with routes from R's descriptor. Both links are operator-level. A reject
   or the 10-minute expiry revokes A's minted token and stores nothing.

## Relay and metering (D-2356-12)

A relay-plan account (`tester` until billing) may dial `rtc+turn://`: the initiator asks the
directory for TURN credentials (`ice-servers { relay: true }`, Cloudflare Realtime, 600 s TTL)
and sets `iceTransportPolicy: 'relay'`. Both ends pass the credential list through
`relayIceServers` (`src/lib/anywhere/channel/relay-ice-servers.ts`, PAN-4862). It puts `turns:` on
port 443 first, then other `turns:`, then `turn:` over TCP, then `turn:` over UDP, and drops STUN
URLs. werift 0.25.1 uses only the first TURN URL, and when UDP is blocked its UDP-to-TCP fallback
starts after about 6.35 s, which the 10 s relay probe cannot afford. Dropping STUN also spares the
responder a 5 s wait for a server-reflexive candidate on a UDP-blocked network. The directory refuses with `relay_not_allowed` (free),
`relay_cap_reached` (month total at 50 GB) or `turn_unavailable` (no TURN secrets), and the
dialer fails with `ChannelOpenError('unreachable', …)`. `relay-client.ts` meters every relay
data channel this machine dialed (the responder never reports, so each channel counts once)
and sends `relay-usage` deltas every 60 s and on close. Each report broadcasts the month's
`relay-status` to every machine, so the status card's traffic line stays current. The report
that reaches the cap broadcasts `relay-status { stopped: true }`; every machine closes its relay channels and the
status card shows the cap message with **Add 50 GB**. Over-run is bounded by one report
interval plus the credential TTL. Counts are self-reported by the account's own machines.

## Webhook inbox (D-20)

A trigger may have a directory inbox, `https://connect.overdeck.ai/h/<doId>.<secret>`
(`POST /api/triggers { inbox: true }`, `pan triggers add --inbox`). The Worker rebuilds the
Durable Object id from the URL (no global index) and hands it only the secret's SHA-256. The
Durable Object seals `{ v, eventId, inboxId, receivedAt, headers, body }` to the owning
machine's key with `crypto_box_seal` (`services/connect/src/seal.ts`, pure JS on `@noble/*`)
and stores only the sealed bytes; the plaintext exists only in the request handler. The
machine opens events with sodium-native's `crypto_box_seal_open`
(`src/lib/anywhere/sealed-box.ts`), handles them one at a time in arrival order
(`inbox-client.ts`, `src/lib/triggers/inbox.ts`), skips ids it already delivered
(`inbox-delivered.json`), refuses events older than 24 h 5 min, and runs steps 2-6 of the
trigger core (`deliverInboxEvent`; a Stripe signature is checked against `receivedAt`).
2xx and terminal 4xx answers send `inbox-ack`; `503` and `429` send `inbox-nack`, re-sent after
`max(retryAfter, 60 s)`. The Durable Object alarm deletes events after 24 hours.

## SSH machines (PAN-4404)

An SSH machine is a machine link whose first route is an SSH port forward that the linking
dashboard set up itself (W-LINK6, epic FR-17, D-13; issue PRD `.pan/drafts/PAN-4404.md`).
User-facing pages: the `## SSH machines` section of `configuration/linked-machines.mdx` and
`add-ssh`, `test-ssh` and `unlink --keep-server` in `cli/machines.mdx`.

| Piece | Where |
| --- | --- |
| Destination grammar, remote command, argv, failure classifier, helper result and version parsing, `~/.ssh/config` aliases | `src/lib/anywhere/ssh/target.ts` |
| `ssh` process runners (async `spawn` and `execFile`, with timeouts) | `src/lib/anywhere/ssh/run.ts` |
| `${OVERDECK_HOME}/ssh-machines.json` (0600, atomic, fail-closed) | `src/lib/anywhere/ssh/machine-store.ts` |
| Remote helper, `pan machines ssh-helper start\|stop` (hidden) | `src/lib/anywhere/ssh/helper.ts`, `src/cli/commands/machines-ssh.ts` |
| Forward supervisor | `src/dashboard/server/services/ssh-forward-supervisor.ts` |
| Add, test, remove, reconnect, the local host lock | `src/dashboard/server/services/ssh-machine-service.ts` |
| `POST /api/machines/ssh`, `POST /api/machines/ssh/test`, `GET /api/machines/ssh/config-hosts` | `src/dashboard/server/routes/machines-ssh.ts` |

### The add flow (D-4404-3)

1. Validate the destination and take the local host lock (in-process, keyed by the
   destination lowercased without `ssh://`; a second add, remove or reconnect for it fails
   at once with `busy`).
2. Version probe over SSH (20 s): the last bare-semver line of `pan --version` must equal
   this server's version, or `version-mismatch`.
3. `ssh-helper start --linker <our environment id> --json` (150 s).
4. A helper whose environment id is ours is `self-link` (a server it started is stopped again).
5. Pick a free loopback port and write a **provisional** record (`linkId: null`).
6. The forward supervisor starts the forward and waits up to 15 s for the port; the port is
   read back from the record, since a collision may have moved it.
7. `createMachineLink({ transport: { url: 'tcp://127.0.0.1:<lp>', kind: 'ssh', pairingCode } })`:
   the PAN-4645 pairing handshake over the forward, with no pairing-URL parsing and no
   loopback refusal.
8. Set the record's link id; drop older records for the same environment id (their forward
   stops; their server never does).

A failure after step 5 stops the forward, deletes the provisional record and, when the
helper reported `managed`, runs `ssh-helper stop` (60 s, best effort). At boot, a record
whose link id is still null (the dashboard died mid-add) is deleted.

### The remote command (D-4404-4, D-4404-5)

Every `ssh` call is an argv array with `-T -o BatchMode=yes -o ConnectTimeout=10
-o ServerAliveInterval=15 -o ServerAliveCountMax=3`, then `-- <destination> <command>`.
The destination is validated and always follows `--`. The command string is always

```
sh -c 'exec "${SHELL:-/bin/sh}" -lc "<pan> <args>"'
```

where `<pan>` is `pan` or a validated absolute path and `<args>` is one of `--version` or
`machines ssh-helper start|stop --linker <uuid> [--no-pair] --json`. Nothing else can reach
it. The forward drops `-T` and adds `-N -o ExitOnForwardFailure=yes
-L 127.0.0.1:<lp>:127.0.0.1:<rp>`. No call ever sets `StrictHostKeyChecking=no` or
`accept-new`: a host key the operator has not accepted fails with `host-key`.

### Helper protocol, marker and lock

The helper prints exactly one line, `OVERDECK_SSH_HELPER <json>` (protocol `v: 1`); the
linking side takes the last such line and ignores login banners. Start answers `launch`,
`apiPort`, `environmentId`, `label`, `serverVersion`, `panVersion` and a one-time pairing
credential (`null` with `--no-pair`); stop answers `stopped` and `reason`. Helper errors are
`busy`, `start-failed`, `pair-failed`, `token-rejected`, `stop-failed` and `bad-linker`; the
linking side keeps `busy` and `start-failed` and maps the rest to `helper-failed`.

- **Remote lock** `${OVERDECK_HOME}/ssh-launch/lock`, a directory made with `mkdir`
  (atomic). It serializes helpers from every linking machine. A lock older than 180 s is
  stale and broken once; otherwise the helper waits up to 30 s, then answers `busy`.
- **Launch marker** `${OVERDECK_HOME}/ssh-launch/server.json` (0600):
  `{ v: 1, pid, apiPort, version, startedAt, startedBy }`, written after the helper starts a
  server. `startedBy` is the linking machine's environment id.

### Adopt and stop rules (D-4404-7, D-4404-8, D-4861-1)

**Start.** The helper reads the API port from the host's `config.toml` (as `pan up` does)
and polls `/api/health`. A dashboard that answers with a `pid` is adopted: `managed` when
the marker names this linker and that pid, else `external` (a marker with another pid is
stale and deleted). Otherwise it spawns `pan up --detach --no-open --skip-traefik` with
piped output (so a sidecar it leaves cannot hold the SSH session open), waits for the
child's `exit` event (120 s), polls health every 500 ms for 30 s, writes the marker and
reports `managed`; no health is `start-failed` with the last 20 output lines.

**Stop**, under the remote lock, in order: no health ⇒ `not-running` (marker deleted); no
marker or another linker ⇒ `external`; marker pid differs from the health pid ⇒
`restarted` (marker deleted); the host's `GET /api/machines` lists an active inbound
machine other than the linker ⇒ `in-use`; otherwise the helper stops the host's
supervisor first (D-4861-1), the same way `pan down` does (the `overdeck-supervisor.service`
user unit when active, else the `supervisor.pid` process), because the supervisor restarts
a dashboard it watches within about 30 s. If a supervisor still answers `/health` on the
supervisor port after 3 s (for example the launchd agent that `pan connect` loads), the
helper answers `stop-failed`, keeps the marker and leaves the server running. Otherwise
`SIGTERM` to the dashboard pid, `SIGKILL` after 10 s, marker deleted, `stopped`. Other
sidecars (CLIProxy, Traefik, smee) are left running and `pan down` is not used, because it
also stops review sessions this machine did not start. A `pan connect` host whose unit is
enabled gets the unit stopped; it starts again at the next boot. The linking side runs stop
only for a `managed` record when the operator did not ask to keep the server, and waits up
to 60 s for it; an unreachable host gives `stop-failed` and the removal goes on.

### Forward supervisor (D-4404-10)

It starts in `startAnywhere` right after the link supervisor (primary dashboard only) and
stops in `stopAnywhere`. States: `starting`, `up` (the local port accepts a connection),
`down`, `attention`. An exit with `auth-failed` or `host-key` stderr goes to `attention`
and is not retried until `ensure()` (Reconnect); `Address already in use` or `cannot listen
to port` picks a new free port, rewrites the link's `ssh` route through `setLinkRoutes`
and the link supervisor's `updateRoutes`, and respawns at once; any other exit is `down`
and retries after 1 s doubling to 60 s with ±20 % jitter, the counter resetting after 60 s
up. The forward pid is recorded; at boot a recorded pid whose `ps -o args=` contains
`-L 127.0.0.1:<lp>:` is sent `SIGTERM` before a new forward starts.

### Running the SSH machine smoke

```bash
npm run build
node scripts/anywhere/ssh-machine-smoke.mjs
```

It never touches the operator's sshd or dashboard. `scripts/anywhere/fake-ssh.mjs` is
installed as `.tmp/ssh-smoke/bin/ssh` and put first on A's `PATH`; it runs remote commands
with `sh -c` under the "remote" home and turns `-N -L …` into a TCP proxy. B (the remote,
`.tmp/ssh-smoke/remote`, port 3062) and A (`.tmp/ssh-smoke/local`, port 3061) are peer-mode
dashboards with `OVERDECK_ANYWHERE_SUPERVISOR=1`. Steps: `start`, `start A`, `add-ssh`
(the view is `external` with an `ssh` route), `online` (within 15 s), `unlink` (reason
`external`, B still healthy), `stop`. `--serve` stops after `start A`, prints A's URL and
the remote pan path for a browser check, and keeps both running until Ctrl-C. The managed
path is not exercised, because `pan up` starts shared sidecars; the helper unit tests cover
it.

## Fleet versions and updates (PAN-4654)

Each machine reports itself and runs its own update; the viewing machine keeps no fleet
state (D-3).

| Route | Scope | What it does |
| --- | --- | --- |
| `GET /api/versions/self` | `read:state` | This machine's report: Overdeck version, install mode, link protocol, one entry per installed harness CLI (by binary) with its version and update plan, and the current update job. `?refresh=1` bypasses the 60 s `--version` cache. |
| `POST /api/versions/self/update` | `operate` | Start the update job (`202`), or with `mode: 'now'` escalate a waiting one (`200`); another start while a job is active is `409 update-in-progress`. |
| `DELETE /api/versions/self/update` | `operate` | Cancel a waiting job (`200`), else `409 not-waiting`. |
| `GET /api/machines/versions` | `admin` | The fleet table: this machine first, then each outbound link; online links are asked for their report in parallel, 2.5 s each. |
| `POST /api/machines/update` | `admin` | Update all: one start (or cancel) request per online linked machine, then this machine last (D-12). |

- **Fencing (D-10).** Through a channel, the update routes need a machine credential on an
  operator-level link with the `operator` actor stamp; an agent stamp or an agent-fenced
  link gets `403 fleet-update-forbidden`. Locally the mutation guard applies and a device or
  token credential needs `admin`. The body carries only `mode`; every command comes from
  the machine's own update plan (NFR-3). The fleet routes refuse any request through a
  channel, and the update routes answer `409 not-primary` on a peer dashboard (D-14).
- **Update plans** (`src/lib/fleet/harness-versions.ts`) read declared capability data
  (`updateArgs`, `npmPackage` in `HarnessCapabilities`), never harness names. Windows never
  runs; a binary under `<prefix>/lib/node_modules/<npmPackage>/` updates with that
  prefix's npm; Homebrew is shown, not run; otherwise the declared `updateArgs`.
- **The job** (`services/fleet-update-service.ts`) lives in `${OVERDECK_HOME}/fleet-update.json`,
  written temp file + rename at every change (D-4). Phases: `waiting`, `updating`,
  `restarting`, `done`, `failed`, `cancelled`. On boot a job left in `restarting` is
  finished from the running Overdeck version (`updated`, or `failed` when the version did
  not change); one left in `waiting` or `updating` is failed as interrupted.
- **Turn wait (D-5).** When-idle waits for zero `working` entries in the live agent
  directory, machine-wide, re-checking every 5 s. It never proceeds on its own; after 30
  minutes the row says it is still waiting and points at Update now.
- **Overdeck last (D-8, D-9).** On `npm-global` installs the job uses the dashboard's one
  `UpdateManager` (`check()`, `install()`, poll), then restarts through
  `restartDashboardDetached()`, the same function `POST /api/system/restart-dashboard`
  uses, so it claims the restart gate and never waits on the approval banner. Development
  and desktop installs skip the Overdeck component. A machine set up with `pan connect`
  also reports `npm-global`. `getUpdateManager()` passes `runtimeHome` when
  `isRuntimePackageRoot(packageRoot, OVERDECK_HOME)`, and `UpdateManager.install()` then
  installs through `ensureDurableRuntime()` into `<OVERDECK_HOME>/runtime` instead of
  `npm install --global` (PAN-4722). `pan sync` runs through `panCliInvocation`, and a
  sync failure after a good install still moves to `ready`, so the restart happens.
- **Older peers (D-11).** There is no capability flag and no protocol bump: a `404` from
  `GET /api/versions/self` means the peer predates fleet updates, and its row names the
  version and command to install. In practice an older peer answers
  `403 { error: 'insufficient_scope', missingScope: 'admin' }` instead, because its
  remote request gate has no scope row for the path and refuses the machine credential
  before routing; that answer is read the same way. A current peer never sends it for
  these paths, since every machine token holds `read:state` and `operate`. Update all
  treats only `403 fleet-update-forbidden` as an agent-fenced link.

## pan connect (W-LINK9, FR-25)

`pan connect` (`src/cli/commands/connect.ts`, registered lazily from `pair.ts`) turns a
machine reached over SSH into a lasting linked machine: durable runtime, primary dashboard,
service, lingering, then one pairing link (`.pan/drafts/PAN-4656.md`).

- **D-1 The supervisor unit, no dashboard unit.** The service is the existing
  `overdeck-supervisor.service`; its watchdog restarts the dashboard through the same
  `pan restart --dashboard` path as every other restart. A `Restart=always` dashboard unit
  would fight `pan restart`, `pan reload` and the watchdog for the port.
- **D-2 `[Install]` always rendered, enabled only by `pan connect`.**
  `renderSupervisorUnit()` ends with `[Install]\nWantedBy=default.target`, so `pan up`'s
  re-render keeps the text stable. `pan up` never runs `systemctl --user enable`, so a
  machine that never ran `pan connect` still does not start the supervisor at boot (PAN-2253).
  `explainSystemdUserUnavailable()` (`src/lib/systemd.ts`) names why the user manager is
  unusable; `systemdUserAvailable()` is that reason being null.
- **D-3 Boot path.** Lingering starts the user manager at boot ⇒ the enabled supervisor unit
  starts ⇒ the watchdog waits out its 5-minute boot grace ⇒ `pan restart --dashboard`
  starts the dashboard. The dashboard answers within about 6 minutes of boot.
- **D-4 Durable runtime.** Under npx, `ensureDurableRuntime()`
  (`src/lib/anywhere/connect-runtime.ts`) runs `npm install --prefix <home>/runtime` of the
  exact running version (never `--global`, which needs sudo on a system Node).
- **D-5 Re-exec.** `pan connect` then re-runs itself from the runtime with
  `OVERDECK_CONNECT_REEXEC=1`, so the unit's `ExecStart`, its `WorkingDirectory`, the
  dashboard bundle and the primary identity all point into the runtime and the watchdog
  never sees the dashboard as foreign. A process with that variable never re-execs.
- **D-8 PATH for the user manager.** `persistUserManagerPath()`
  (`src/lib/systemd-user-session.ts`) writes `~/.config/environment.d/60-overdeck.conf`
  and runs `systemctl --user set-environment PATH=…` before the unit starts, minus any
  `/git-guard` shim directory. The unit itself carries no `PATH`, because `pan up`
  re-renders it from whatever shell runs it.
- **D-10 macOS.** `src/lib/launchd.ts` writes `~/Library/LaunchAgents/ai.overdeck.supervisor.plist`
  (`RunAtLoad`, `KeepAlive`) and bootstraps it into `gui/<uid>`, falling back to
  `user/<uid>`; a changed plist is booted out first. The agent starts at login only. `pan up`
  on a Mac with the agent loaded does not start a second supervisor. The dashboard server
  itself runs as a plain detached child of the supervisor: only Linux starts it in a `systemd-run` transient unit,
  so macOS prints no PAN-2804 systemd warning (PAN-4896). macOS 15+'s Local
  Network privacy then applies to that launch agent (PAN-4897): the link supervisor
  (`src/dashboard/server/services/link-supervisor.ts`) names the denial only when every LAN
  `tcp://` route failed with `EHOSTUNREACH` (classified by `src/lib/anywhere/local-network.ts`)
  **and** a gateway probe (`src/lib/anywhere/local-network-probe.ts`) confirms this process's
  own access is denied; the probe is injected into `LinkSupervisorDeps.localNetworkAccess`
  only on darwin, so linux and the phone build never run it.

Update all, the update dialog and `pan update` reinstall into the same runtime (PAN-4722).

## Fly machines (PAN-4652)

A Fly machine is a Fly.io VM that runs `pan serve` and is linked one way from home
(W-FLY2, epic FR-18, D-12; issue PRD `.pan/drafts/PAN-4652.md`). It is an ordinary linked
machine: its conversations stream into home's list with a `fly-<machineId>` chip and come
home with **Pull here**. Since [PAN-4734](https://github.com/eltmon/overdeck/issues/4734)
it also hosts `pan start --remote` work agents (`### Work agents (PAN-4734)` below). A
legacy remote work agent VM (`src/lib/remote/remote-agents.ts`, created before PAN-4734)
runs Claude Code in raw tmux and no Overdeck server. User-facing pages: the
`## Fly machines` section of `configuration/linked-machines.mdx` and `add-fly` in
`cli/machines.mdx`.

| Piece | Where |
| --- | --- |
| Provisioning and `destroyFlyVm` | `src/lib/anywhere/fly/provision.ts` |
| `FlyMachineError` and its status map, `pollUntil`, `detached` (re-exported by `provision.ts`) | `src/lib/anywhere/fly/provision-shared.ts` |
| Codex sign-in: snapshot, newest-refresh-wins decision, VM read/push, home write, provisioning step 6b | `src/lib/anywhere/fly/codex-auth.ts` |
| Project clone on the VM | `src/lib/anywhere/fly/project.ts` |
| `${OVERDECK_HOME}/fly-machines.json` (0600, atomic; a corrupt file throws and is never rewritten) | `src/lib/anywhere/fly/machine-store.ts` |
| `addFlyMachine`, `startFlyConversation`, `removeFlyMachineForLink` (unlink hook) | `src/dashboard/server/services/fly-machine-service.ts` |
| `POST /api/machines/fly` | `src/dashboard/server/routes/machines-fly.ts` |
| `startFlyWorkAgent` (PAN-4734) | `src/dashboard/server/services/fly-work-agent-service.ts` |
| `POST /api/remote/work-agents` (PAN-4734) | `src/dashboard/server/routes/remote-work-agents.ts` |
| `pan start --remote`, `--machine fly` (PAN-4734) | `src/cli/commands/start-remote.ts` |
| The issue worktree on the VM, `ensureFlyWorkspace` (PAN-4734) | `src/lib/anywhere/fly/project.ts` |
| `pan machines add-fly` | `src/cli/commands/machines-fly.ts` |
| Heartbeat, sweep and Codex sign-in sync loops | `src/lib/remote/fly-machine-loops.ts` (registered in `src/lib/cloister/hygiene-scheduler.ts`) |
| Credential refresh | `src/lib/remote/remote-credential-refresh.ts` (Fly machine names join the remote agents' VMs) |
| Spend cap | `checkRemoteSpendCap` in `src/lib/remote/remote-agents.ts` counts Fly machine records |
| The Fly target door: `startFlyTarget`, `FlySpawn`, `FLY_MACHINE_TAGS` (PAN-4743) | `src/dashboard/server/services/fleet-fly-target.ts` |
| The Add-a-Fly-machine dialog (Settings → Anywhere → Machines) | `src/dashboard/frontend/src/components/Settings/anywhere/AddFlyMachineDialog.tsx` |

### Decisions

- **D-1 The VM issues the pairing code; home links.** Codes are held only by the server that
  issued them, so home runs `pan pair --json` on the VM through the Machines exec API and
  links with the `credential` it prints. The code travels only over the Fly-authenticated
  exec channel, never over the route being paired (the same property SSH machines have).
- **D-2 One-way link.** Home links to the VM (`bothWays: false`, access `operator`). The VM
  cannot reach home's LAN or tailnet, and home's dashboard needs nothing from the VM.
- **D-3 Public route = WSS on 443 with instance pinning.** The machine config carries
  `services: [{ protocol: 'tcp', internal_port: 3011, ports: [{ port: 443, handlers: ['tls', 'http'] }] }]`.
  The route is `wss://<app>.fly.dev/ws/link?fly-instance=<machineId>`, kind `public`, source
  `pairing`. Every machine in an app shares `<app>.fly.dev`, so the route pins one.
- **D-4 The VM server's environment.** `pan serve --port 3011 --no-open` runs detached with
  `OVERDECK_TERMINAL_BACKEND=tmux` (no Herdr on the image), `IS_SANDBOX=1` (Claude Code runs
  as root), `OVERDECK_PUBLIC_LINK_ONLY=1` and `PORT=3011`. It never sets
  `OVERDECK_DISABLE_DEACON`, which would make it a peer that hosts no machine links. The env
  is on the command line, not in the image, so remote work agent VMs are unchanged.
- **D-9 Destroy, never stop.** Unlink, the idle sweep and the stopped-machine sweep all
  destroy the machine. Its rootfs resets on every start, so a stopped Fly machine has
  already lost its server state and conversations.

### The `fly-instance` route parameter

`FLY_INSTANCE_PARAM` (`src/lib/anywhere/channel/open.ts`) names a reserved query parameter
on a `wss://` route. `parseTransportUrl` removes it from the URL it dials and sends its value
as the `fly-force-instance-id` header on the WebSocket upgrade, which the Fly proxy honors.
Every other URL is dialled unchanged. `parseRouteUrl` (`src/lib/anywhere/routes.ts`) keeps
that one parameter when it canonicalizes a `wss` route, so the stored route still pins the
machine and two machines in one app keep distinct route URLs; any other query is dropped.

### Public-link-only mode

With `OVERDECK_PUBLIC_LINK_ONLY=1`, rule 0b of the remote request gate
(`src/dashboard/server/remote-request-gate.ts`) answers 404 to every HTTP request that is
neither inside a secure channel nor from a loopback peer without a proxy forwarding header,
on every path including the static SPA. The `/ws/link` upgrade is handled before the gate,
so home still links in, and a link-mode channel request is judged by its machine credential
as before. On a Fly machine this makes the public URL answer nothing but the link.

A server in this mode also advertises no endpoints: `discoverEndpoints` returns `[]`, the
same as under `OVERDECK_ANYWHERE_NO_ADVERTISE=1` (PAN-4741). So home's link to a Fly machine
holds only the `public` pairing route, and a link created before this change drops its stale
`advertised` routes through `mergeAdvertised` on its next connect.

### The record file

`fly-machines.json` holds `{ v: 1, machines: FlyMachineRecord[] }`, one record per Fly
machine: `id`, `linkId` (null while provisioning), `environmentId`, `machineId`,
`machineName` (`overdeck-machine-<8 hex>`, unique in the app because the Fly provider
resolves machines by name), `appName`, `region`, `label` (`fly-<machineId>`), `projectKey`,
`docker`, `codexAuthPath` (PAN-4296; a record written before it reads as `null`) and
`createdAt`. It is a separate file from `machine-links.json` because
`upsertLink` rebuilds link records field by field. Unlike `ssh-machines.json`, a corrupt
file makes every read throw: the cap and the sweep must not act on an empty list that is
not really empty. `countFlyMachines()` is synchronous because `checkRemoteSpendCap` and its
callers are.

### Provisioning (`provisionFlyMachine`)

Each remote step runs through `FlyApiClient.execCommand` with a 60 s deadline; anything
longer runs detached (`setsid nohup … &`) and is polled.

1. `ensureApp`, and a fresh `overdeck-machine-<8 hex>` name.
2. `createMachine` with the D-3 service, `restart: no`, `metadata.overdeck = machine` and
   `max(remote.fly.vm_memory ?? 1024, 2048)` MB (the server plus Claude Code do not fit in 1 GB).
3. `waitForState(started, 300 s)`.
4. Version equality: when the VM's `pan --version` differs from home's `package.json`
   version, `npm install -g @overdeck/core@<home>` runs detached and is polled every 5 s for
   at most 5 min; a second mismatch fails with `version-mismatch`.
5. Identity: `<home>/environment-id.json` with `{ v: 1, environmentId, label:
   "fly-<machineId>", createdAt }`, mode 0600, before the server first starts (the label is
   fixed at link time). `<home>` is read from the exec shell
   (`${OVERDECK_HOME:-$HOME/.overdeck}`), never assumed: Fly's exec shell runs with `HOME=/`,
   so the server, `pan pair` and the project clone all use `/.overdeck`, and an identity
   written to `/root/.overdeck` is never read.
6. `syncAllCredentials` and `configureClaudeCode` through the Fly provider (Claude OAuth file
   and `gh auth token`; no SSH key reaches the VM). A missing Claude credential fails only a
   `claude-code` machine. Step 6b, `prepareFlyCodex`, pins the Codex CLI and pushes the
   Codex sign-in (`### Codex (PAN-4296)`).
7. Docker: when `command -v dockerd` succeeds, `dockerd --storage-driver=vfs` starts
   detached and `docker info` is polled every 2 s for 60 s; the result is the record's
   `docker` field and a failure never fails provisioning. The default overlay driver cannot
   mount on the VM's root filesystem ("invalid argument"); `vfs` runs containers, at the
   cost of speed and disk.
8. Server: `pan serve` with the D-4 env, then `curl /api/health` every 2 s for 120 s, or
   `server-not-ready` with the last 40 lines of `<home>/fly-serve.log`.
9. Watchdog: the PAN-4295 ephemeral watchdog at `/workspace/.pan/fly-machine-watchdog.js`
   and the first heartbeat; the VM stops itself 300 s after home stops heartbeating.
10. `pan pair --json`; its `credential` must match `odp_` + 64 hex, else `pairing-failed`.
11. The D-3 route URL.

A failure after `createMachine` destroys the machine before rethrowing, because the caller
never learns the id of a failed provision.

### Adding (`addFlyMachine`)

The early refusals create nothing: `remote.enabled` not true (`remote-disabled`; PAN-4905 —
the message names config.toml's display path and the exact `enabled = true` line under
`[remote]` via `remoteEnabledHint()` in `lib/remote-enabled.ts`, and adds a sentence when the
global config.yaml's `remote:` section has its own `enabled` key, which nothing reads), no Fly
token (`no-fly-token`), a harness that cannot run on a Fly machine (`harness-unsupported`;
Claude Code and Codex can, see `### Codex (PAN-4296)`), a message without a project
(`bad-request`), and the spend cap (`cap-reached`). Then it provisions,
writes a provisional record, links (`createMachineLink` with the public route; an
`unreachable` link names the one-time `fly ips allocate-v4 --shared` / `allocate-v6` fix),
patches the record, wakes the link supervisor, clones the project (`pan project clone
https://github.com/<repo>.git --parent /workspace --name <key>`, detached, up to 20 min, then
`pan project list --json` must list it) and starts the conversation (`POST
/api/conversations` through the link as the operator). Any failure after provisioning
destroys the machine, removes the link if one was made and deletes the record.
`notifyLinksChanged` is a required argument because its module (`routes/machines.ts`)
imports this service for the unlink hook. The route runs the whole flow in one request; the
CLI sends it with `node:http` because Node's fetch gives up on response headers after 300 s.

`GET /api/machines` reports `self.remoteEnabled` (effective `loadConfig().remote?.enabled
=== true`) and `self.remoteConfigFile` (config.toml's display path), both optional so older
linked peers and fixtures still decode. The dashboard's Add a Fly machine dialog reads these
before any click on Add to show a "Remote is off" notice and disable Add, with no extra
route (PAN-4905). Its **Turn on remote** button calls `POST /api/machines/fly/enable-remote`,
which refuses a secure-channel request and an unsafe dashboard mutation like
`POST /api/machines/fly` does, then calls `enableRemoteInConfigToml()` — a minimal line edit
that sets `[remote] enabled = true`, preserves every other byte of config.toml, is a no-op
when already true, and throws `RemoteEnableError` (409, writing nothing) when the file does
not parse or the edit would not read back `remote.enabled === true` (an inline `remote = {
… }` table or a dotted key would make the appended `[remote]` header a duplicate
definition). On success the dialog refetches `GET /api/machines` to re-enable Add.

### The loops

The deacon child's hygiene scheduler runs all three every 60 s, outside the deacon freeze.
With zero records none builds a Fly client.

- `heartbeatFlyMachines` writes `/workspace/.pan/host-heartbeat` on every machine by
  machine id. A failed exec is a failure line, never "refreshed".
- `sweepFlyMachines` destroys the machine, removes the link and deletes the record when the
  API reports `stopped`, `destroyed` or `failed`, or answers 404 (any other API error does
  nothing); when no unreleased linked conversation on it is `active` or had activity inside
  the window for `remote.fly.machine_idle_minutes` (default 30, 0 disables); or when its
  record still has no link 30 minutes after creation. The idle clock is in memory, and the
  sweep reads the linked-conversation cache read-only. A failed destroy keeps the link and
  record for the next tick.
- `syncFlyCodexAuth` keeps the Codex sign-in in step by newest refresh wins (see
  `### Codex (PAN-4296)`).
- The credential refresh copies fresh Claude credentials to Fly machines by name with the
  same per-VM watermark as remote agents.

### Codex (PAN-4296)

A Fly machine also runs Codex conversations (W-FLY3, epic FR-18; issue PRD
`.pan/drafts/PAN-4296.md`). `CODEX_CAPABILITIES.runsOnFlyMachine` is `true`; every other
non-Claude harness stays `false`.

- **D-1 No provider routing.** A Codex conversation runs `codex app-server` with the Codex
  CLI's own sign-in and calls OpenAI directly. It never uses CLIProxy, so nothing installs,
  starts or tunnels CLIProxy on the VM.
- **D-2 Codex is prepared whenever home can.** Home can when `resolveHarnessBinary('codex')`
  finds a binary, `readCodexCliVersion` reads its version, and
  `classifyNativeCodexAuth(~/.codex/auth.json)` is `valid` (`readHomeCodexState`).
  Provisioning step 6b (`prepareFlyCodex`) then runs for every Fly machine, so a machine
  started for Claude Code can take a Codex conversation later. A miss fails provisioning
  only for `harness: 'codex'` (`credentials-failed` or `version-mismatch`); otherwise it is
  logged and `codexAuthPath` is `null`. Claude Code credentials, in turn, are required only
  for `harness: 'claude-code'`.
- **D-3 Newest refresh wins.** OpenAI rotates the refresh token on every refresh, so a copy
  of `auth.json` forks the token family and whichever side refreshes second is signed out.
  `syncFlyCodexAuth` (every 60 s, outside the deacon freeze) reads each Codex-ready VM's
  file and runs `decideCodexAuthSync(home, vm)` over parsed snapshots. The comparison key is
  the sign-in's content (`[access_token, id_token, refresh_token, account_id,
  last_refresh]`, or the `OPENAI_API_KEY`), never the bytes, so whitespace never causes a
  push. The rules, in order:

  | # | Condition | Action |
  | --- | --- | --- |
  | 1 | home missing, or home's mode unknown | none |
  | 2 | VM missing, or VM's mode unknown | push |
  | 3 | same mode and same key | none |
  | 4 | both ChatGPT, same non-empty `account_id`, VM copy has all four tokens, VM `last_refresh` strictly newer | pull |
  | 5 | anything else | push (home decides which account is signed in) |

  A pull writes home's file atomically (temp file in the same directory, then rename, mode
  0600), and through a symlinked `auth.json` to its target. Just before a pull, home's
  file is read again and the decision is made again, so a home sign-in that changed during
  the pass is never overwritten by an older VM copy. Only one pass runs at a time: the
  scheduler skips a tick while the previous pass is still running. A read that exits
  non-zero or throws is indeterminate and does nothing. A refresh on both sides inside one 60 s window
  still signs one side out; `codex login` at home fixes it on the next push.
- **D-4 The VM path comes from the exec shell.** `printf %s "$HOME/.codex"` prints
  `//.codex` in Fly's exec shell (`HOME=/`); `//` collapses to `/`, and the result must be
  absolute. That is where `pan serve`, started from the same shell, finds the sign-in:
  each conversation's managed `CODEX_HOME` symlinks `auth.json` to `$HOME/.codex/auth.json`.
  The push writes a temp file with mode 0600 and renames it, so those symlinks stay valid.
- **D-6 Version pin by install.** When the VM's `codex --version` differs from home's,
  `npm install -g @openai/codex@<home>` runs detached and `/tmp/codex-install.exit` is
  polled every 5 s for at most 5 min, then the version is checked again. Home's version
  predicts the VM's, so the model floor `canUseHarness` checks at home holds on the VM.
- **Checked at home first (D-5).** `addFlyMachine` refuses a Codex request before any VM
  exists: no `model` is `bad-request` (no default model), a non-OpenAI model or a denied
  `canUseHarness('codex', …)` is `harness-unsupported`, and no usable home Codex is
  `credentials-failed`.
- **The record.** `codexAuthPath` holds the VM path of the sign-in when Codex was prepared,
  else `null`. `syncFlyCodexAuth` acts only on records with a link and a `codexAuthPath`;
  with none it builds no Fly client.

No `auth.json` content, token or base64 of either appears in a log line, an activity entry
or an error: the VM read and push helpers name only the path and the exit code.

### Work agents (PAN-4734)

`pan start <id> --remote` and `pan start <id> --machine fly` run the work agent as a
conversation on a new Fly machine (issue PRD `.pan/drafts/PAN-4734.md`; closes PAN-1775).

- **The work door.** The CLI (`startRemoteWorkAgent`) refuses the durable tier, an issue
  with legacy remote workspace metadata and a feature branch that is not on origin after
  its push. It then posts `POST /api/remote/work-agents` with no client timeout, because
  provisioning needs the link supervisor (`notifyLinksChanged`) and the link pool. The
  route refuses a channel caller (403), as every operator machines route does.
- **The service (`startFlyWorkAgent`).** It refuses an unknown project (404), a
  non-Anthropic model (400 `harness-unsupported`) and an agent whose remote-state is
  `running` or under 30 minutes `starting` (409) before any VM exists. It saves remote-state
  `starting` with `linked: true` and `vmName: ''`, runs `addFlyMachine({ projectKey,
  harness: 'claude-code' })`, adds the worktree `/workspace/<project>/workspaces/feature-<issue>`
  with `git worktree add` on the pushed branch (not `pan workspace create`, whose 10 GiB
  disk floor a Fly rootfs may not meet), copies home's `continue.json` and the skills,
  starts the conversation through the link with `cwd` and `issueId`, installs the push
  daemon in the worktree and saves `running`. The first message is the REMOTE work
  prompt, or a pointer to `/workspace/.pan/prompts/agent-<issue>.md` when the prompt is
  over 50,000 characters. A failure after provisioning unlinks the machine (which destroys
  it through the unlink hook) and saves `error`. Non-operator starts run inside the
  auto-spawn consent claim.
- **Remote-state's linked fields.** `linked`, `environmentId`, `linkId`, `flyMachineId`,
  `conversationName`, `tmuxSession` (`conv-<name>`), `tmuxSocket` (`overdeck`, the VM
  server's default instance), `projectKey` and `workdir`; `vmName` is the Fly machine name.
  `FlyProvider.resolveVm` resolves that name through `fly-machines.json`, so exec reaches
  the machine in whatever app provisioned it.
- **Tmux target resolution.** `remoteTmuxTarget(agentId)` returns `{ session: tmuxSession ??
  agentId, socket: tmuxSocket }`. Output capture, `pan tell`, keyed delivery, `pan kill`
  and the reap's probe address that target; a legacy state produces the old commands byte
  for byte, so callers are unchanged.
- **Loop rules.** The spend cap's agent count, the remote heartbeat and the credential
  refresh's agent list skip a linked state, because its Fly machine record already counts,
  heartbeats and syncs the VM (FR-10). `sweepFlyMachines` never idle-removes a machine whose
  environment hosts a linked agent that is `starting` or `running` (FR-11); gone and
  never-linked machines are removed as before.
- **The reap.** On `REMOTE_DONE` and a pushed branch it copies
  `<workdir>/.overdeck/continue.json` home, hands the branch to review, kills the session and
  destroys, unlinks and forgets the Fly machine through `destroyAndForgetFlyMachine`. It
  never calls `fly.deleteVm` or deletes workspace metadata for a linked agent. On a crash it
  salvages the worktree and stops the machine; the sweep removes it once the state is no
  longer active.
- **The issue tree.** Resource discovery lists every cached linked conversation with an
  `issueId` and no `releasedTo` under that issue with `origin: 'linked'`, and the tree row
  opens `/conv/@<environmentId>/<name>`.

### Split

The Machine field, **Fly (new VM)** and `--machine fly` for other commands are #4651;
lanes on Fly are #4638. Codex on Fly is #4296 (above); other harnesses cannot run on a Fly
machine, and Codex does not run as a Fly work agent.

## Decisions added by sibling issues

Placeholder headings for the decisions that land with the follow-up issues; each adds its
section here when it ships.

- #2356: D-3, D-20.

## Conversations across machines (#4650)

### The shared list and its cache (D-5, D-4650-1/2/3)

The owner answers `GET /api/machines/conversations` (machine credential only,
`read:conversations`) with the FR-1 metadata of every local, unarchived conversation
(`src/lib/anywhere/shared-conversations.ts`), plus each row's `vaultId` and
`pulledFrom`, or `sharing: false` and hash `sharing-off` when **Share my conversations**
is off (`${OVERDECK_HOME}/anywhere.json`). The hash (first 16 hex of SHA-256 over the
rows sorted by name) rides in the 15 s heartbeat as `conversationsHash`; a beat waits at
most 1 s for it and otherwise carries the last known hash, so a slow list never reads as
a network stall.

The viewer keeps the answers in `linked_conversations` (`src/lib/overdeck/linked-conversations.ts`;
the owner's answer is its only writer). `linked-conversations-sync.ts` fetches on every
connect and when a heartbeat's hash differs from the cached one; nothing polls. The
link reconcile prunes environments with no active link. `GET /api/conversations` merges
the cache on page 1 (`linked-conversations-merge.ts`): one row per conversation, local
over linked over the vault saved copy (`vault-<vaultId>`); hidden or unlinked machines
and rows released to this machine are left out; linked rows are named
`@<environmentId>/<ownerName>` with negative ids. `?linked=0` lists local rows only.

### Remote control: the proxy prefix and the WebSocket pipes (D-4650-4/5/6)

`linked-conversation-proxy.ts` forwards `/api/conversations/@<machine>/<name>[/…]` to the
owner's `/api/conversations/<name>[/…]` over the link (`linkForward`, bodies up to
32 MiB), so every existing frontend call works for a linked row. It acts only on requests
the remote request gate admits; the prefix needs `admin`, so a machine credential
arriving over a channel cannot hop on. The actor is `operator` for the browser and for
operator CLIs (`x-overdeck-sender`), else the agent. `/ws/linked/<env>/rpc` and
`/ws/linked/<env>/terminal` (`ws-linked.ts`) relay the browser's WebSocket handshake to
the owner's `/ws/rpc` or `/ws/terminal` with the link token and no Origin, then pipe
bytes. The owner's scope table decides what is allowed; the remote-control routes
(messages, approvals, stop, abort, switch model, compact, resume, attachments, tool
bodies, diffs, image upload) carry `read:conversations`, `tell`, `approve` or `operate`.

A loopback browser request passes the remote gate without a credential, and the owner
sees every forwarded write as the operator, so the proxy refuses a write (any method but
GET and HEAD) unless it carries a header-borne credential (the CLI's internal token or an
API token, which no cross-site page can attach) or a trusted Origin or Referer (the
dashboard's own fetches). The viewer's own writes (`POST /api/linked-conversations/pull`,
`POST /api/conversations/:name/reclaim`, `POST /api/linked-conversations/open-in-editor`)
use `rejectUnsafeDashboardMutationRequest`: JSON only, plus a trusted Origin and the CSRF
token unless a header-borne credential is present.

The phone app (`/m`) opens a linked row by its linked name and takes the row from the
merged `GET /api/conversations` list, never from `GET /api/conversations/@<machine>/<name>`.
The proxy above returns the owner's own row (positive id, local name), which would make
the panel subscribe on this machine's `/ws/rpc` and stay on "Discovering conversation…"
(PAN-4871).

### The agent fence (D-4650-7)

On the owner, a `machine` credential whose actor is an agent (an `agent-fenced` link's
operator included) is refused `agent-fenced` on every non-GET `/api/conversations`
route, on `/ws/terminal` and on `/ws/forward` (`src/dashboard/server/link-fence.ts`).
Reads stay allowed.

### Release before adopt (D-8, D-4650-8 to D-4650-14)

A released conversation refuses every write door with 409 `conversation-released`
(`src/lib/overdeck/conversation-release.ts`), in-process callers included. Pull here is a
viewer job (`services/conversation-pull.ts`): **release** (the owner marks
`released_to`, settles the transcript with uncommitted code into a fresh `dir:` vault
store under a fresh key, packs it and stops the harness; any failure clears the mark),
**transfer** (the pack crosses the channel; the key travels only in the release answer),
**adopt** (Continue here against the unpacked store) and **finish**. Settling uses an
empty in-memory vault index (`settle({ index })`), so the transfer carries the whole
transcript and never moves the owner's real vault tail; after adopting, the viewer drops
the transfer store's tail from its own index. The transfer record is titled with the
owner's conversation title (`recordTitle`), and Continue here copies that title to the
adopted row, so a pulled conversation keeps its title (PAN-4904). Once released, any transfer or adopt
failure posts `release/undo`, and the owner resumes. Nothing undoes a release on a
timer: `pan conv reclaim` does it by hand, refusing while the other machine runs the
conversation. Adoption mints a new session id, so the pulled row records `pulled_from`;
a push back archives the old released copy by it. An unreachable owner falls back to the
vault saved copy and its compare-and-swap.

### Port forwards (D-22, D-4650-16/17)

`/ws/forward?port=<n>` (`ws-forward.ts`) needs a channel `machine` credential with the
`forward` scope and the operator actor, connects only to `127.0.0.1:<port>`, and refuses
(403 `port-refused`, before the upgrade) ports outside 1024-65535 and Overdeck's own
(dashboard, API, supervisor, 80, 443, Traefik's dashboard port; `forward-ports.ts`). The
viewer (`services/port-forwards.ts`) probes first, then listens on `127.0.0.1:0` and gives
each connection its own channel; a forward closes on stop, on unlink or after 30 idle
minutes. `GET /api/conversations/:name/preview-ports` lists the workspace's assigned
ports and service ports.

## Work across machines (#4651)

Decisions: `.pan/drafts/PAN-4651.md` (D-4651-1 … D-4651-24); epic D-19 (Auto placement)
and D-21 (MCP fleet reach). The vocabulary is PAN-4650's: the machine you sit at is the
**viewer**, the machine that runs a piece of work is its **owner**.

### Work doors and provenance (D-4651-1/2/3)

Owner routes under `/api/machines/work/*` (`routes/machines-work.ts`) are the only way a
linked machine starts work here. Each takes exactly a `machine` credential (403
`machine-only`), resolves the project on this machine, and compares the caller's git
origin slug with that project's (case-insensitive; 404 `project-missing` naming this
machine otherwise). The caller never names a path. The new-conversation dialog follows
this: `createFleetConversation` never sends `cwd`, and with another machine chosen the
Working directory field shows `machineCwdHint` (`newConversation/MachineField.tsx`)
instead of this machine's path (PAN-4872). `conversations` runs
`handleConversationCreate`; `workers` runs `startWorker` with `startedBy` written into
`worker.json`; `issues/:id/start` runs `spawnIssueAgentForRoute`
(`routes/agents/spawn-issue.ts`, the extracted body of `POST /api/agents`); `projects`
(operator actor on an operator-level link only) clones and copies files.

`conversations.started_by_environment_id` records the asking machine
(`overdeck/conversation-provenance.ts`, the only writer). The agent fence
(`link-fence.ts`, synchronous) lets an agent actor call the work-door creates and change
only conversations whose provenance is its own environment; bare creates
(`/api/conversations`, `/api/workers`, `/api/lanes`), the project door, `/ws/terminal` and
`/ws/forward` stay refused. `POST /api/workers/:id/stop` checks `worker.json` itself.

### Delegation follower (D-4651-4/5/6/7)

`POST /api/fleet/workers` with a remote target allocates a local **stand-in** id
(`~/.overdeck/agents/<localId>/`, `agents/worker/remote-standin.ts`), calls the owner's
worker door and writes `remote.json` (0600). `services/remote-worker-follower.ts`, started
in `startAnywhere`, resumes every running stand-in at boot, polls the owner's
`GET /api/workers/:id/status?after=<seq>` every 5 s while the link is online, mirrors
reports with the owner's `seq`, marks a confirmed-dead worker `exited`, backs off 1 s
doubling to 300 s (±20 %) while unreachable without ever giving up, and after two dead
observations of the parent posts the owner's stop once. `pan worker wait` reads a
stand-in through `remote.json` (`worker-remote.ts`). Remote `pan worker run` and
`pan start` refuse unpushed commits (`delegation-push-check.ts`) and send
`x-overdeck-sender`, so an agent's delegation reaches the owner as that agent.

### Auto placement (D-19, D-4651-8/9/10)

Each machine samples its load every 15 s (`services/machine-load.ts`: CPU PSI avg10, the
governor's saturated verdict, available memory, working agents) and detects capability
tags every 10 minutes (`anywhere/machine-capabilities.ts`: OS, `docker`, `gpu`,
`ios-sim`, plus `anywhere.machine.tags`; `anywhere.machine.placement: on-request` reserves
the machine). Both ride in the heartbeat, never in the public descriptor. The supervisor
keeps each peer's last values. `choosePlacement` (`anywhere/placement.ts`, pure) rejects
offline/unsupported, `no project`, `no <tag>`, `CPU saturated`, then `reserved` (unless
only reserved machines have the needed tag), and scores by lowest PSI, most memory, fewest
working agents, this machine, label. `services/fleet-target.ts` resolves every fleet
spawn's `machine` (self, `auto`, a link label or id, `fly`). `fly` calls the Fly target door
(`services/fleet-fly-target.ts`, `startFlyTarget`) when the route passes a spawn context
(`FlySpawn`: `projectKey`, `harness?`, `model?`, `mayCreate`); without one it answers 400
`fly-unavailable`. Only `POST /api/fleet/conversations` passes a spawn — `mayCreateFly` on
`FleetCaller`, true only for an admin credential (PAN-4743 D-4743-4); workers, issue starts
and lanes pass none, so `fly` there always refuses. `auto` falls back to the Fly target door
too, when nothing else fits, the spawn and git origin are set, `needs` stays within
`FLY_MACHINE_TAGS` (`linux`, `docker`) and `remote.auto_fly` is `true`.
`OVERDECK_TEST_FORCE_CPU_SATURATED=1` is the smoke hook, read only by `machine-load.ts`.

### Projects, Needs-You and search across machines (D-4651-11 … D-4651-16)

Owners serve `GET /api/machines/projects` and `GET /api/machines/needs-you` and put their
hashes in the heartbeat (`projectsHash`, `needsYouHash`); the viewer caches them in memory
(`linked-projects-sync.ts`, `linked-needs-you-sync.ts`), fetching on connect and on a
changed hash only. `GET /api/fleet/projects` groups by git origin slug
(`anywhere.json` `combineRepositories`, default on); `GET /api/fleet/needs-you`,
`GET /api/fleet/search` (2.5 s per link) and `GET /api/fleet/issues/:id/activity` combine
online links. "Add this project" uses the project-creation core in both directions
(`services/fleet-add-project.ts`); copied files are the owner's git-ignored files up to
1 MiB (`projects/ignored-files.ts`), cross only an operator-level link for the operator,
are written 0600 and never overwrite.

`GET /api/needs-you` (`read:conversations`, PAN-4944) serves this machine's feed to any
token, with agent question and permission-request ids; `GET /api/machines/needs-you` stays
machine-credential only and unchanged.

### MCP fleet reach (D-21, D-4651-17/18)

`requiredScopeFor` judges `/api/conversations/@<machine>/<rest>` by `/api/conversations/<rest>`,
so a token's scopes reach linked conversations; the proxy refuses any channel caller first
(403 `no-chained-hops`). For an `odk_` token the proxy forwards actor `operator` with
`x-overdeck-link-ceiling` set to the token's own scopes (from the resolved credential,
never a header), so the owner applies exactly what the operator granted. The MCP tools use
`GET /api/fleet/machines`, `/api/fleet/search` and the fleet spawn routes; settings stay
unreachable (machine tokens never carry `admin`).

### Fleet usage and compare (D-4651-19/20/21)

`GET /api/fleet/usage` reads this machine's month window and request digest in one scan
(`costs/request-digest.ts`) and each online link's `GET /api/costs/summary` and
`GET /api/costs/request-digest` (`read:costs`); offline links answer cached totals from
`fleet-usage-cache.json` (0600). All machines subtracts, per window, every request hash an
earlier machine already counted. `GET /api/fleet/settings-compare/:machine` compares
`GET /api/settings/resolved` (`settings-resolved.ts`: explicitly set `config.yaml` keys,
secrets only as set / not set) and prints `pan admin config set` lines; links never change
settings.

## Gauntlet lanes across machines (#4638)

Decisions: `.pan/drafts/PAN-4638.md` (D-4638-1 … D-4638-16); epic W-WORK3. The machine
that runs the orchestrator and `pan lane start` is **home**; the machine that runs a
remote lane is its **owner**.

### Validate at home, execute on the owner (D-4638-1/2/3/9/10/11)

`launchLane` (`lanes/launch.ts`) keeps every rule that needs the run's rows: parent and
launcher standing, run, critic link and default `--at`, iteration, idempotency, model,
harness and effort. It reads lanes through `listAllLaneRows` (`lanes/lane-rows.ts`), which
merges local lane conversations with the stand-ins. With a remote target it skips home's
CPU check, refuses an orchestrator lane, refuses on a Fly machine a harness whose
capabilities lack `runsOnFlyMachine` (Claude Code and Codex have it; #4296) and refuses `--machine` with `--reuse` (D-4638-8). It allocates a name
free in `conversations` and claimed in the stand-in store (`reserveRemoteLane`, an empty
directory), and calls the owner with a precomputed `OwnerLaneSpec`: name, iteration,
branch, base, `at`, brief header, the verdict a builder answers. `name-taken` retries with
a new name up to 3 times; any other refusal, or an unreached owner, removes the claim.
On 201 home writes `lane.json` with the owner's cwd, which only the owner knows.

`POST /api/lanes` (`routes/lanes.ts`) gives `launchLane` a `resolveMachine` dependency:
`resolveTargetMachine` (`fly` answers 400 `fly-unavailable`, #4743), the project's git
origin, a 403 `no-chained-hops` for a secure-channel caller (D-4638-12), `isFly` from the
Fly machine store, and the owner calls through `postWorkDoor` as the caller's actor
(`x-overdeck-sender`, 30 s, 503 `machine-unreachable`), with refusals through
`ownerRefusal`. The same resolver serves a `--reuse` whose newest lane ran elsewhere and
`--replace` of a live lane on another machine. An Auto pick of this machine resolves to a
`LocalLanePlacement` (`self: true`, reason, rejections), never to `null`, so the result's
`placement` explains it while `machine` stays `null` and home follows nothing (#5006).

The owner doors live in `routes/machines-work-lanes.ts`, machine credential only:
`POST /api/machines/work/lanes`, `GET /api/machines/work/lanes/:name/status?after=<seq>` and
`POST /api/machines/work/lanes/:name/reap`. The launch door resolves
the owner's own project by git origin alone and runs `launchOwnedLane`
(`lanes/owner-launch.ts`): its own CPU check (429 unless `force`), the harness check, the
worktree under its own lanes root (a builder's base falls back to `origin/<base>`; a
critic's commit must have arrived through `origin`, FR-9), the brief, a lane row with lane
facts and **no parent** (`createConversation` with `remoteLaunch` and
`refuseExistingName`), the `started_by_environment_id` stamp, and the runtime with the
lane contract. The status and reap doors answer 404 `unknown-lane` unless the caller's
environment started the lane; status returns at most 20 reports after `after`.

### The stand-in (D-4638-4/5/7, NFR-1, NFR-3)

Home never inserts a `conversations` row for a remote lane. `lanes/remote-lanes.ts` keeps
`~/.overdeck/remote-lanes/<name>/`: `lane.json` (write-once launch facts), `mirror.json`
(the follower's copy of the owner's state: activity, git facts, cost, last seen,
`unreachableSince`, last assistant message, spawn error) and `archived.json` (written once
by reap). All are 0600; `mirror.json` is replaced through a temp file and rename. Reports
are mirrored to `agents/conv-<name>/reports/`, so every report reader works unchanged. A
local critic of a remote builder keeps its link in `agents/conv-<critic>/lane-link.json`.
D7 iteration groups on a cwd key, `<environmentId>:<cwd>` for a remote lane, because two
machines with the same home layout produce the same path.

### The follower (D-4638-14, NFR-4, NFR-5)

`services/remote-lane-follower.ts`, started in `startAnywhere` next to the worker follower,
resumes every stand-in that is not archived and not gone, polls the owner's status door
every 5 s as the operator while the link is online (at most 20 reports per poll), and backs
off 1 s doubling to 300 s (±20 %) while unreachable, never giving up. 404 `unknown-lane`
marks the mirror `gone`. It never stops a remote lane when its parent ends, as local lanes
do not stop. `POST /api/lanes` starts following a new launch at once (`followRemoteLane`).

### Views, CLI, stop and reap (D-4638-6/13/15)

`listLaneViews` builds on `listAllLaneRows`: a remote lane's view has `id: null` and
`machine: { environmentId, label, reachable, lastSeenAt }`, and its activity, git facts,
cost and last activity come from the mirror; nothing runs git or reads liveness at home
for it. Pairing (`lanes/pairing.ts`) keys on conversation names. `GET /api/lanes/:name`
answers a stand-in. `waitForLane` judges a stand-in from its mirror and counts an
unreachable owner as alive. `POST /api/lanes/:name/stop` and `…/reap` forward a remote lane
to the owner's conversation stop door and lane reap door; reap archives the stand-in after
the owner's 200 (unless `keep`) or its 404 `unknown-lane` (with a warning), and archives
nothing when the owner is unreachable. The agent fence refuses an agent actor on
`POST /api/lanes/<name>/reap` here; the owner reap door checks provenance instead. A
remote lane is messaged as `@<label>/<name>`.

### Nesting (FR-8)

`mergeConversationRows` (`overdeck/linked-conversations-merge.ts`) stamps a remote lane's
linked row with the stand-in's parent, run, key, role, critic link and home's project key,
so the Command Deck tree nests it under its orchestrator and the Awareness rail counts it
in the run card, with no frontend change.

PAN-5005: lane list fields (`laneReport`, `laneIteration`, `laneVerdict`, `laneLatestVerdict`)
come from `laneFieldsByRun` in `lanes/lane-list-fields.ts`, which pairs over
`listAllLaneRows` (local and remote lanes of a run) instead of the home-only context
`conversation-list.ts` used before. `getMergedConversationList` passes them to
`mergeConversationRows` through `RemoteLaneEntry.fields`, which is spread onto the stamped
row alongside the lane facts above. `laneLatestVerdict.criticRoute` is the critic's route
key — `@<environmentId>/<name>` for a remote critic, its numeric id as a string for a local
one — so a builder's verdict link opens the right row on either machine.

Live check, 2026-11-01: the three-machine run (orchestrator and builders on the desktop,
critics on a Fly machine and the laptop) did not run before merge: no laptop or Fly machine
was linked to the desktop, and the desktop dashboard runs `main`, which has no lane doors
until this lands. Fallback per the plan: the two-machine smoke on this branch (two local
servers, A as home and B as the laptop) passed `lane-remote`, `lane-report`, `lane-nest`
and `lane-reap`. The three-machine check (laptop rig and a Fly machine) runs after release
and `pan reload`, tracked in #4760.

Live check, 2026-11-04 (build `65e3b1adf86`, 0.73.1 on all three machines): passed. Three builders on the
desktop; critics on a Fly machine (`add-fly`) and the laptop rig each judged a builder's pushed head and
reported PASS; `--machine auto` chose the Fly machine by CPU pressure, `--needs macos` the laptop and
`--needs docker` the desktop. All 8 lanes were listed under the orchestrator in `pan lane list` and the
Command Deck. The tree showed no report badges for remote lanes, fixed by #5005. Auto prints no reason when it
picks this machine (#5006). Evidence: `.pan/uat/pan-4638/check-1-three-machine-gauntlet.md`.
