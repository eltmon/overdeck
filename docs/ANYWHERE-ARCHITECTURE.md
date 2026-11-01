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

The live check for this layer is a script, not a CI job (D-4645-22): it binds two
LAN-visible ports for a few seconds and needs a built tree.

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
| `fake-clis` | fresh homes, each with a fake `HOME`, a fake npm prefix holding fake `claude` 2.1.0 and `codex` 0.150.0, and a fake `npm`; the servers run on a hard link to Node in `.tmp/anywhere-node/bin` (see below) |
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
| `kill B` | after `SIGKILL`, A shows the link offline within 30 s |
| `restart B` | A shows it online again within 60 s |
| `no-http` | the proxy capture starts with the channel preamble byte `0x00` and contains no `HTTP/1.1` |
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
failure path can be checked (it then fails at `no-http`). The work agent runs the
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
carries the stream, both pinned exactly and loaded with `createRequire` because they
reach `sodium-native` prebuilt binaries. Two patterns:

- **IK** for a link whose peer key is pinned: the initiator (`openChannel`,
  `src/lib/anywhere/channel/open.ts`) proves its own key and names the responder's in
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

The same bytes travel over raw TCP (`tcp://host:port`, routes `lan`, `tailnet`,
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

## One session per connection; the same port (D-4645-3, D-4645-4)

Every transport connection is one Noise session with a one-round-trip IK handshake; there
is no multiplexer. HTTP keep-alive pools amortise the handshake: each channel gets one
`http.Agent` (`src/lib/anywhere/channel/channel-agent.ts`, `maxSockets: 1`) that every
channel HTTP client uses, and `LinkAgent` (`src/lib/anywhere/link-client.ts`) pools up to
four channels per linked machine for `linkFetch`. A plain `http.request` with only
`createConnection` would send `Connection: close` and the peer would end the channel after
the first answer, which is exactly what the first smoke run hit.

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

## `/ws/rpc` restricted group (D-4645-14, D-4645-15)

RPC middleware sees per-message headers, not the upgrade, so the group is chosen at upgrade
time (`ws-rpc-auth.ts`): an admin credential gets the full `PanRpcGroup`; a machine, device
or token credential gets the group with every tag omitted whose `RPC_METHOD_SCOPES` entry is
outside the credential's scopes. Revoking the credential closes its sockets with code 4401,
the raw socket found through the request's `IncomingMessage`, for `net.Socket` and
`ChannelSocket` alike.

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
  above 1 MiB). Either side may open channels on an existing connection, so both accept them.
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
  smoke uses it so only `direct` can link two dashboards on one host).

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
and sets `iceTransportPolicy: 'relay'`. The directory refuses with `relay_not_allowed` (free),
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
helper reported `managed`, runs `ssh-helper stop` (45 s, best effort). At boot, a record
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

### Adopt and stop rules (D-4404-7, D-4404-8)

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
machine other than the linker ⇒ `in-use`; otherwise `SIGTERM` to that pid, `SIGKILL`
after 10 s, marker deleted, `stopped`. Only the dashboard process is signalled; `pan down`
is not used because it also stops Traefik and review sessions this machine did not start.
The linking side runs stop only for a `managed` record when the operator did not ask to
keep the server; an unreachable host gives `stop-failed` and the removal goes on.

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
  and desktop installs skip the Overdeck component.
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
  on a Mac with the agent loaded does not start a second supervisor.

## Fly machines (PAN-4652)

A Fly machine is a Fly.io VM that runs `pan serve` and is linked one way from home
(W-FLY2, epic FR-18, D-12; issue PRD `.pan/drafts/PAN-4652.md`). It is an ordinary linked
machine: its conversations stream into home's list with a `fly-<machineId>` chip and come
home with **Pull here**. It is a different thing from a remote work agent VM
(`pan start --remote`, `src/lib/remote/remote-agents.ts`), which runs Claude Code in raw
tmux and no Overdeck server; moving those onto this path is
[PAN-4734](https://github.com/eltmon/overdeck/issues/4734). User-facing pages: the
`## Fly machines` section of `configuration/linked-machines.mdx` and `add-fly` in
`cli/machines.mdx`.

| Piece | Where |
| --- | --- |
| Provisioning, `destroyFlyVm`, `FlyMachineError` and its status map | `src/lib/anywhere/fly/provision.ts` |
| Project clone on the VM | `src/lib/anywhere/fly/project.ts` |
| `${OVERDECK_HOME}/fly-machines.json` (0600, atomic; a corrupt file throws and is never rewritten) | `src/lib/anywhere/fly/machine-store.ts` |
| `addFlyMachine`, `startFlyConversation`, `removeFlyMachineForLink` (unlink hook) | `src/dashboard/server/services/fly-machine-service.ts` |
| `POST /api/machines/fly` | `src/dashboard/server/routes/machines-fly.ts` |
| `pan machines add-fly` | `src/cli/commands/machines-fly.ts` |
| Heartbeat and sweep loops | `src/lib/remote/fly-machine-loops.ts` (registered in `src/lib/cloister/hygiene-scheduler.ts`) |
| Credential refresh | `src/lib/remote/remote-credential-refresh.ts` (Fly machine names join the remote agents' VMs) |
| Spend cap | `checkRemoteSpendCap` in `src/lib/remote/remote-agents.ts` counts Fly machine records |

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

### The record file

`fly-machines.json` holds `{ v: 1, machines: FlyMachineRecord[] }`, one record per Fly
machine: `id`, `linkId` (null while provisioning), `environmentId`, `machineId`,
`machineName` (`overdeck-machine-<8 hex>`, unique in the app because the Fly provider
resolves machines by name), `appName`, `region`, `label` (`fly-<machineId>`), `projectKey`,
`docker` and `createdAt`. It is a separate file from `machine-links.json` because
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
5. Identity: `/root/.overdeck/environment-id.json` with `{ v: 1, environmentId, label:
   "fly-<machineId>", createdAt }`, mode 0600, before the server first starts (the label is
   fixed at link time).
6. `syncAllCredentials` and `configureClaudeCode` through the Fly provider (Claude OAuth file
   and `gh auth token`; no SSH key reaches the VM).
7. Docker: when `command -v dockerd` succeeds, `dockerd` starts detached and `docker info`
   is polled every 2 s for 60 s; the result is the record's `docker` field and a failure
   never fails provisioning.
8. Server: `pan serve` with the D-4 env, then `curl /api/health` every 2 s for 120 s, or
   `server-not-ready` with the last 40 lines of `/root/.overdeck/fly-serve.log`.
9. Watchdog: the PAN-4295 ephemeral watchdog at `/workspace/.pan/fly-machine-watchdog.js`
   and the first heartbeat; the VM stops itself 300 s after home stops heartbeating.
10. `pan pair --json`; its `credential` must match `odp_` + 64 hex, else `pairing-failed`.
11. The D-3 route URL.

A failure after `createMachine` destroys the machine before rethrowing, because the caller
never learns the id of a failed provision.

### Adding (`addFlyMachine`)

The early refusals create nothing: `remote.enabled` not true (`remote-disabled`), no Fly token
(`no-fly-token`), a harness other than Claude Code (`harness-unsupported`, #4296), a message
without a project (`bad-request`), and the spend cap (`cap-reached`). Then it provisions,
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

### The loops

The deacon child's hygiene scheduler runs both every 60 s, outside the deacon freeze. With
zero records neither builds a Fly client.

- `heartbeatFlyMachines` writes `/workspace/.pan/host-heartbeat` on every machine by
  machine id. A failed exec is a failure line, never "refreshed".
- `sweepFlyMachines` destroys the machine, removes the link and deletes the record when the
  API reports `stopped`, `destroyed` or `failed`, or answers 404 (any other API error does
  nothing); when no unreleased linked conversation on it is `active` or had activity inside
  the window for `remote.fly.machine_idle_minutes` (default 30, 0 disables); or when its
  record still has no link 30 minutes after creation. The idle clock is in memory, and the
  sweep reads the linked-conversation cache read-only. A failed destroy keeps the link and
  record for the next tick.
- The credential refresh copies fresh Claude credentials to Fly machines by name with the
  same per-VM watermark as remote agents.

### Split

`pan start --remote` work agents moving onto this path, and their session rows (closing
PAN-1775), are [PAN-4734](https://github.com/eltmon/overdeck/issues/4734). The Machine
field, **Fly (new VM)** and `--machine fly` are #4651; lanes on Fly are #4638; other
harnesses on Fly are #4296.

## Decisions added by sibling issues

Placeholder headings for the decisions that land with the follow-up issues; each adds its
section here when it ships.

- #4651: D-19, D-21.
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
the transfer store's tail from its own index. Once released, any transfer or adopt
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
- #4651: D-19, D-21.
