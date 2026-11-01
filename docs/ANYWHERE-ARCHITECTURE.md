# Overdeck Anywhere: machine links, the secure channel and routes

PAN-4645 is the foundation of Overdeck Anywhere (PRD `.pan/drafts/pan-2350.md`,
revision 5; issue PRD `.pan/drafts/PAN-4645.md`): two machines that each run their
own Overdeck link their dashboards server to server over an end-to-end encrypted
channel, learn how to reach each other, and watch each other's health. Sibling
issues build the conversation views, the relay and the desktop flows on top of
these pieces. User-facing pages: `configuration/linked-machines.mdx` and
`cli/machines.mdx`.

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
| `start` | both servers answer `GET /api/environment` within 90 s |
| `proxy` | a byte-logging TCP proxy on a free loopback port fronts B |
| `pair+link` | `pan pair --url http://127.0.0.1:<proxy> --json` on B, `pan machines link <url> --allow-loopback --json` on A; B holds the reverse link |
| `online` | both `pan machines list --json` show the other online within 15 s, and A's current route is the proxy (the pairing route outranks B's advertised LAN routes by source order) |
| `seed` | (#4650) B gets a local conversation with a >2 MiB transcript, an image and a vault index entry; A gets a saved copy of it |
| `list` | A's `GET /api/conversations` lists `@<B>/<name>` once, carrying the saved copy |
| `open-budget` | opening it through A moves at most 1,114,112 bytes B to A |
| `image` | its attachment through A matches B's bytes |
| `tell-once` | a repeated `pan tell … --message-id` gets the same answer; the same id with other text is refused |
| `released-409` | with `released_to` set on B, a message through A answers 409 `conversation-released` |
| `forward` | `pan machines forward` reaches a dev server on B; B's dashboard port is refused |
| `kill B` | after `SIGKILL`, A shows the link offline within 30 s |
| `restart B` | A shows it online again within 60 s |
| `no-http` | the proxy capture starts with the channel preamble byte `0x00` and contains no `HTTP/1.1` |
| `stop` | both servers stopped; nothing outside `.tmp/anywhere-a|b` touched |

Exit 0 on success, exit 1 with `FAILED at step <name>: <why>` otherwise.
`--live-claude` adds `remote-reply` (a real Claude conversation on B answers a message
sent from A) and `pull` (`pan conv pull` brings it, with an uncommitted change, to A, and
B then answers 409 `conversation-released`); its harnesses run on the smoke homes' own
tmux sockets. Without it, both servers get their own `HOME` under the smoke home.
`--inject-plain-http` sends one plain request through the proxy so the detector's
failure path can be checked (it then fails at `no-http`). The work agent runs the
script before `pan done` and pastes the output into the PR description.

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

The Noise prologue binds the mode and the pairing id: `overdeck-link/1\0<mode byte>\0<pairing id hex or empty>`.

## Wire format (D-4645-5)

The same bytes travel over raw TCP (`tcp://host:port`, routes `lan`, `tailnet`,
`public`) and as the binary payload of a `/ws/link` WebSocket (`wss://host/ws/link`).

1. The initiator sends the preamble `00 4F 56 44 4C <linkProtocol=01> <mode>`; mode
   `01` is link (IK), `02` is pairing (XXpsk0), and pairing appends the 16-byte pairing id.
2. Handshake messages travel as `uint24le length` + message, at most 1024 bytes. A frame
   of length 0 followed by one code byte is a refusal: `01` unknown peer key, `02`
   unsupported link protocol (then a `uint8` responder protocol and a length-prefixed
   UTF-8 server version), `03` unknown or expired pairing id, `04` busy (the responder
   has 32 handshakes pending).
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
- #2356: D-3, D-20.
