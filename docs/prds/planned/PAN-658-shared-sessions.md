# PAN-658 — Shared Sessions v0

**Issue:** [PAN-658](https://github.com/eltmon/panopticon-cli/issues/658)
**Status:** Planned
**Date:** 2026-05-21
**Followups:** agent-session sharing, collaborative markdown editing (PAN-659 lineage), hosted read-only web view

---

## Problem

Panopticon is a bundled local client/server app — every user runs the dashboard on their own
localhost, and the conversation data, the Claude Code JSONL session, and the tmux session all
live on that one machine behind that user's NAT. There is no way for two people on a refinement
call to look at the same conversation, watch the same investigation unfold, or collaboratively
shape a prompt. The natural model — "give somebody a link" — does not work: the link would point
at a machine the recipient cannot route to.

The killer use case: a refinement call where one person drives a codebase investigation in
Panopticon and the rest of the team watches live, suggests prompts, and collaboratively converges
on the right next step.

## Goal

Let a Panopticon host share **one conversation** with other Panopticon users via a
`panopticon-cli.com/s/<id>` link. Viewers render that conversation live in their own local
Panopticon dashboard. Delivered as:

1. A new **signaling service** deployed at `panopticon-cli.com` (WebRTC handshake, GitHub OAuth, TURN).
2. A **host-side WebRTC transport** in the dashboard server, hub for N viewers.
3. A **viewer-side** shared-conversation surface in the dashboard frontend (browser-native WebRTC).
4. **Invite-only access control**: host-approval lobby, admit / kick / revoke, per-session block list.
5. **Host role & handoff**, **link lifecycle**, **disconnect/reconnect resilience**.
6. **Input model**: live prompt-suggestion drafts + an opt-in direct-submit (contributor) permission.
7. **Two first-class clients**: dashboard and CLI (`pan share`, `pan join`).

This issue is **Shared Sessions v0**. Per the repo policy on complete features, all sections of
this PRD ship together under PAN-658 — the phase numbering below is implementation sequencing, not
separate deliverables.

## Design Goals

- **Invite-only is non-negotiable.** Possession of a link never, by itself, grants access.
- **Content stays peer-to-peer.** The signaling service relays handshake + membership only; it
  never sees conversation, terminal, or draft content.
- **The viewer needs no native dependency.** The host's Node server is the WebRTC hub; viewers
  connect with browser-native WebRTC.
- **Survive a host blip.** A wifi drop or a `pan` restart inside a 5-minute window does not end
  the session or force re-admission.
- **Two clients, one access model.** Dashboard and CLI both share and join; both funnel through
  the same lobby. The CLI is not a back door.
- **Defense in depth.** The host's WebRTC peer independently gates content on its own admitted
  set — it never trusts the signaling service as the sole authority.

---

## Dependencies & Sequencing

### PAN-1249 — `src/lib/` Effect migration (in flight on `feature/pan-1249`)

A sweeping additive migration of all 254 production files under `src/lib/` from Promise-based I/O
to Effect-native I/O is nearly complete on `feature/pan-1249` (not yet merged to main). Relevant
facts for this PRD:

- The migration is **strictly additive** — every `fn(): Promise<T>` keeps its signature; a sibling
  `fnEffect(): Effect.Effect<T, E>` is added alongside. No public API removed, no callers changed.
  Code that imports from `src/lib/` keeps working unchanged.
- Wave 0 of PAN-1249 adds **`src/lib/errors.ts`** with 16+ shared `Data.TaggedError` classes
  (`VcsError`, `FsError`, `GitError`, `TrackerError`, `ProcessSpawnError`, `ConfigError`, …).
  **`src/lib/errors.ts` does not exist on `main` today** — it arrives with PAN-1249.
- The dashboard server (`src/dashboard/server/`) is already Effect-native. The CLI
  surface (`src/cli/`) remains Promise-based and consumes both flavors.

**Sequencing decision for PAN-658:**

- **Preferred:** start PAN-658 after `feature/pan-1249` merges to `main`. The conflict surface is
  near-zero (Shared Sessions adds new modules; it does not edit migrated files), but starting
  after merge means `src/lib/errors.ts` exists and the Effect error-tag conventions are settled.
- **If PAN-658 must start first:** branch from `feature/pan-1249` (not `main`) so `src/lib/errors.ts`
  is present, then rebase onto `main` once PAN-1249 lands.
- **New error tags** introduced by this feature (see *New Error Types*) are added to
  `src/lib/errors.ts`, following the PAN-1249 convention — not scattered into local files.
- New host-side modules under `src/dashboard/server/` are written **Effect-native** from the start
  (the dashboard server already is). New CLI modules under `src/cli/` stay Promise-based and may
  consume either the Promise or the `*Effect` variant of any `src/lib/` API they need.

### New native dependency

The host-side WebRTC peer needs a Node WebRTC implementation. Two candidates, decided at the start
of Phase 2:

| Option | Type | Trade-off |
|---|---|---|
| `werift` | **Pure TypeScript** WebRTC | No native addon — eliminates the build/runtime risk entirely. Preferred if data-channel support is mature enough (it is data-channel-first). |
| `@roamhq/wrtc` | Native Node addon | Battle-tested, but native-addon class of finickiness — same as `node-pty`. Node 22 only; breaks under Bun. |

**Recommendation:** evaluate `werift` first; it removes the native-dependency risk the issue
flagged. Fall back to `@roamhq/wrtc` only if `werift` data channels prove inadequate. Either way:

- If a native addon is used, it must be externalized in the server `tsdown.config.ts` bundle and
  added to `.claude/rules/dashboard-node22-only.md`. Sharing then requires the built
  `dist/dashboard/server.js` under Node 22 — it will not work under `bun run` dev mode.
- `werift` (pure TS) works under both Node and Bun and is the cleaner fit for the dev-mode story.

The viewer side uses **browser-native `RTCPeerConnection`** — no dependency either way.

---

## Architecture

### Components

```
   HOST machine                  panopticon-cli.com               VIEWER machine
 ┌────────────────┐          ┌──────────────────────┐         ┌────────────────────┐
 │ dashboard       │  WS      │  signaling service    │   WS    │ dashboard frontend │
 │  server (Node)  │◄────────►│  - room registry      │◄───────►│  (browser)         │
 │  - conversation │ signaling│  - GitHub OAuth        │signaling│  - RTCPeerConnection│
 │    store, JSONL │          │  - TURN cred issuer    │         │  - shared conv view│
 │  - tmux session │          │  - SDP/ICE relay only  │         └─────────┬──────────┘
 │  - WebRTC hub   │          └──────────────────────┘                    │
 │   (werift/wrtc) │                                                       │
 │       │         │           WebRTC DataChannels (DTLS-encrypted)         │
 │       └─────────┼───────────────────────────────────────────────────────┘
 │                 │       STUN-direct (~80%) or TURN-relayed (~20%)
 └────────────────┘
```

- **Host** — the machine that owns the conversation + tmux session. Its dashboard **server** is
  the WebRTC hub: one `RTCPeerConnection` per viewer. Source of truth.
- **Viewer** — runs their own Panopticon. The **browser** frontend holds one `RTCPeerConnection`
  to the host server and renders the shared conversation. The viewer's local server is a thin
  bootstrap only (receives the join intent, opens the frontend route).
- **Signaling service** (`panopticon-cli.com`) — new deployable. WebRTC handshake relay, GitHub
  OAuth, TURN credential issuance, room registry. **Never sees conversation content.**
- **TURN server** — `coturn` for the ~20% of peer pairs that cannot NAT-traverse directly.

### Two-role decomposition of "host"

| Role | What it is | Mobility |
|---|---|---|
| **Data owner** | The machine with the conversation + tmux session; the WebRTC hub. | Fixed for the session. The conversation does not migrate machines in v0. |
| **Controller** | The participant who *drives*: admit/kick/revoke, pick/send prompts, grant contributor, hand off. | Transferable to any admitted viewer; the data owner can always reclaim it. Exactly one at a time. |

This is why "host" is modeled as a **role on the room**, not a property of a connection.

### Why the hub is the host's server, not the host's browser

- The conversation source of truth, the JSONL session, and the `tmux` session all live in the
  host's Node server. Terminal sharing (`node-pty tmux attach-session`) originates there.
- The host's browser tab is ephemeral; the server is always-on under `pan up`. A host closing or
  refreshing a tab must not drop every viewer.
- Disconnect/reconnect resilience (5-minute window, survives `pan` restart) only makes sense with
  a long-lived server peer.

### Reuse: the terminal-sharing primitive

`src/dashboard/server/ws-terminal.ts` already implements a multi-client hub: one `node-pty`
process per tmux session, an `activePtyHubs` Map, `broadcastToHub()` fan-out, and a single
designated `inputClient`. v0 adds a **WebRTC DataChannel transport** as a second consumer of that
same hub's byte stream — the PTY plumbing is unchanged; the terminal data channel is just another
subscriber alongside the existing raw-WebSocket clients.

---

## The Signaling Service

A new deployable workspace: **`services/signaling-service/`** (Bun workspace; Node 22 runtime).

**Hosting:** deploy to `panopticon-cli.com` behind TLS. Recommended target: **Fly.io** (Panopticon
already has Fly tooling and the `pan-fly` skill). `coturn` runs as a companion Fly app or VM. Final
infra placement is an ops decision to confirm at Phase 1 kickoff.

The signaling service is **stateless except for in-memory room state** — no database. Room state
is small and ephemeral; losing it on a deploy ends in-flight shares (acceptable for v0, documented).

### HTTP API

| Method & path | Caller | Purpose |
|---|---|---|
| `POST /api/sessions` | host | Create a room. Body `{ conversationId, mode }`. Returns `{ roomId, hostToken, shortCode, joinUrl }`. `joinUrl = https://panopticon-cli.com/s/<shortCode>`. |
| `DELETE /api/sessions/:roomId` | host (`hostToken`) | Revoke the link; tear the room down; drop all participants. |
| `GET /s/:shortCode` | viewer browser | Join landing page. Triggers GitHub OAuth, then localhost-detect / `pan join` handoff. |
| `GET /oauth/github/start?room=<shortCode>` | viewer browser | Redirect into GitHub OAuth (`read:user` scope only). |
| `GET /oauth/github/callback` | GitHub | Exchange code, mint a viewer **identity JWT**, redirect to the handoff page. |
| `POST /api/oauth/device/start` | CLI | Begin GitHub **device flow** for `pan join`. |
| `POST /api/oauth/device/poll` | CLI | Poll device flow; on success returns the viewer identity JWT. |
| `POST /api/turn-credentials` | host + viewer | Issue short-lived `coturn` REST credentials (HMAC, ~10-min TTL). |

### WebSocket API — `WS /signal`

- `?role=host&token=<hostToken>` — host parks here. Receives `viewer-joined` (lobby),
  `viewer-signal` (SDP/ICE from a viewer), `viewer-left`. Sends `signal` (SDP/ICE to a viewer),
  `admit`/`kick`/`revoke`/`contributor`/`handoff` control commands, `room-state` snapshots.
- `?role=viewer&room=<roomId>&identity=<viewerJWT>` — viewer signaling channel. Exchanges SDP/ICE
  with the host; receives lobby/admit/kick/revoke notifications.

### Room state (in-memory)

```ts
interface Room {
  roomId: string;            // opaque, 128-bit
  shortCode: string;         // URL-safe, 8-char base32 — the /s/<shortCode> segment
  hostToken: string;         // bearer secret, host-only
  conversationId: string;    // opaque to the service
  mode: 'conversation' | 'terminal';
  controllerGithubId: string;
  hostConnected: boolean;
  hostLastSeen: number;      // epoch ms — drives the 5-minute reconnect TTL
  participants: Map<string /*githubId*/, {
    login: string; name: string; avatarUrl: string;
    state: 'lobby' | 'admitted';
    contributor: boolean;
    connId: string;
  }>;
  blockList: Set<string>;    // githubIds barred from the lobby for this room's life
}
```

**Lifecycle / TTL:** a room is destroyed when (a) the host `DELETE`s it, (b) the host signals
session-end, or (c) `hostConnected === false` for **5 minutes** (`now - hostLastSeen > 300_000`).
There is no fixed-duration link expiry — link lifetime = conversation lifetime.

### What the signaling service can and cannot see

- **Sees:** room membership (GitHub identities of host + viewers), admit/kick/revoke/handoff
  control commands, presence join/leave, SDP/ICE blobs.
- **Never sees:** conversation messages, terminal bytes, prompt drafts. Those flow only over the
  peer-to-peer WebRTC DataChannels. This is enforced by the wire format (content channels are
  never sent to the signaling WS) and verified by an e2e test.

---

## Identity & GitHub OAuth

- **OAuth scope: `read:user` only.** Enough for login + avatar. The collaborative-markdown-editor
  followup may later need `gist`; if so we request that scope then and accept a one-time
  re-consent. We do not ask for gist write access before a feature uses it.
- The GitHub OAuth app is registered to `panopticon-cli.com` and its client secret lives **only**
  on the signaling service.
- After OAuth (browser redirect flow) or device flow (CLI), the signaling service mints a
  short-lived **identity JWT**, signed with the service's private key:

  ```
  { iss: "panopticon-cli.com", sub: "<github-user-id>", login, name,
    avatar_url, room: "<roomId>", iat, exp }   // exp ~15 min
  ```

- The **host verifies this JWT** against the signaling service's published JWKS. The host does
  *not* perform OAuth itself for viewers — it trusts the signaling service's signed identity
  assertion. This is why a viewer's claimed GitHub identity is trustworthy in the lobby.
- **Host identity:** the host is a participant too (shown in presence). The host's Panopticon
  performs a one-time GitHub **device-flow** OAuth the first time it shares; the resulting identity
  is cached at `~/.panopticon/github-identity.json`. No repeated logins.

GitHub OAuth supplies *identity/accountability*. The lobby + block list supply *authorization*.
Both are required; neither alone is sufficient.

---

## Access Control — Invite-Only

Invite-only is a **hard requirement**. The `/s/<shortCode>` link is a routing token, not a
capability — every participant is in the room only because the controller let them in.

### The lobby

1. A joiner authenticates via GitHub and connects to `WS /signal?role=viewer`.
2. They land in the room's **lobby** (`state: 'lobby'`). The signaling service forwards a
   `viewer-joined` event to the host with the joiner's GitHub avatar + handle.
3. **No WebRTC offer is created and no DataChannel is opened** until the controller admits them.
   A lobby viewer receives zero conversation/terminal/draft/presence content.
4. The controller **admits** → the host creates an `RTCPeerConnection`, exchanges SDP/ICE via the
   signaling relay, opens the data channels, and backfills history.

### Controller actions

| Action | Effect |
|---|---|
| **admit** | Move a lobby joiner into the room; host opens their peer connection + channels. |
| **kick** *(soft)* | Tear down that viewer's `RTCPeerConnection` immediately; their UI shows "removed by host". A kicked user who re-clicks the link **re-enters the lobby** and can be re-admitted. For "not right now". |
| **revoke** *(hard)* | Tear down channels **and** add the GitHub id to the room's `blockList`. Works on a connected viewer *or* a lobby joiner. A revoked user re-clicking the link cannot re-enter the lobby and cannot be re-admitted unless the controller un-revokes. For "not at all". The block list is what makes invite-only enforceable against a leaked link. |
| **un-revoke** | Remove a GitHub id from the `blockList`. |
| **revoke link** | `DELETE /api/sessions/:roomId` — kills the whole room; drops every participant (lobby + admitted). |

### Defense in depth — the host gates content itself

The host's WebRTC hub keeps its **own** in-memory admitted set and **only opens content data
channels to viewers it has itself admitted** — it never treats the signaling service's room state
as the sole authority. A compromised or buggy signaling service could mis-report membership, but
it cannot make the host stream content to an un-admitted peer.

On a host **process restart** within the reconnect window, the host's in-memory set is gone; it
re-reads the admitted + block lists from the signaling service room state to resume. That is a
narrow, documented trust window on a Panopticon-operated service, and only membership metadata
(never content) is involved.

---

## Host Role & Handoff

- The **controller** role is transferable to any admitted viewer mid-session ("you drive for a
  while"). The data-owner machine stays the hub and the authority — it accepts control commands
  (admit/kick/revoke, contributor grants, send-prompt) only from the participant who currently
  holds the controller role.
- **Handoff:** the current controller assigns the role to a chosen viewer (a `handoff` control
  message). The **data owner can always reclaim** the controller role unilaterally — it is their
  machine and their conversation.
- Exactly one controller exists at any time. `controllerGithubId` in the room state is the single
  source of truth; the host enforces it on every inbound control command.

---

## Link Lifecycle & Disconnect/Reconnect

### Link lifecycle

- **Link lifetime = conversation lifetime.** The `/s/<shortCode>` link is valid as long as the
  host keeps the conversation shared. It expires automatically when the host ends/closes the
  shared conversation (the room is torn down).
- **No fixed-duration expiry** — no 24-hour timer.
- **Manual link revoke** stays available at any time (`DELETE /api/sessions/:roomId`), dropping
  every participant including those in the lobby.

### Host disconnect & reconnect

- If the host's network blips or its dashboard process restarts, viewers show a
  "host disconnected — reconnecting…" state and always have a manual **Leave** action.
- **Reconnect window: 5 minutes.** The signaling service holds the room (id, host token, admitted
  list, block list, contributor grants) for 5 minutes after `hostConnected` goes false.
- **Within the window:** the host re-parks on `WS /signal` with the same `hostToken`, re-reads
  room state, and **admitted viewers auto-restore** — their peer connections are re-negotiated
  with no re-admission. This holds even across a full host *process* restart, because membership
  lives in the signaling room state, not only in host memory.
- **Past the window:** the room is destroyed, the link dies; a fresh share creates a fresh room
  and everyone re-joins through the lobby.

To survive a process restart, the host persists a minimal record locally (see *Data Model*) so it
knows which room to re-park on after `pan up` comes back.

---

## Transport & Wire Format

### Peer connections and data channels

One `RTCPeerConnection` per viewer (host hub ⇄ viewer browser). Each carries five labeled,
**reliable, ordered** WebRTC DataChannels:

| Channel | Direction | Payload |
|---|---|---|
| `control` | bidirectional | admit / kick / revoke / contributor-grant / handoff / send-prompt + acks |
| `conversation` | host → viewer | conversation history backfill + live message append/update |
| `drafts` | bidirectional | per-viewer prompt-draft snapshots, broadcast to all participants |
| `terminal` | host → viewer | raw `tmux` bytes — only while the viewer has terminal view toggled |
| `presence` | host → viewer | lobby + admitted roster, join/leave, contributor flags |

ICE: STUN-direct preferred; `coturn` TURN relay fallback. DataChannels are DTLS-encrypted by
default — content is encrypted in transit end to end.

### Scoped, versioned wire format

Conversation events cross the channel in a wire format defined **specifically for sharing** — not
the internal `PanRpcGroup` / `ChatMessage` types. Host and viewer run independently-updated
Panopticon versions; coupling the wire format to an internal type would break rendering on version
skew. The wire format is an explicit allow-list of fields permitted to cross the host→viewer
boundary. It lives in `packages/contracts/src/sharing.ts` and is exported from `@panctl/contracts`.

```ts
interface SharedEnvelope {
  v: 1;                                   // wire format version — bump on breaking change
  ch: 'control'|'conversation'|'drafts'|'terminal'|'presence';
  seq: number;                            // per-channel monotonic, for gap detection
  t: number;                              // host epoch ms
  payload: unknown;                       // channel-specific, schemas below
}

// conversation channel
type ConversationPayload =
  | { kind: 'history'; messages: SharedMessage[] }      // full backfill on join
  | { kind: 'append';  message: SharedMessage }
  | { kind: 'update';  message: SharedMessage };        // streaming token updates

interface SharedMessage {                 // explicit subset mapped from internal ChatMessage
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId?: string;
  author?: { login: string; avatarUrl: string };        // which human sent a user message
  createdAt: string;
  completedAt?: string;
  streaming?: boolean;
  sequence?: number;
}

// presence channel
interface PresencePayload {
  controllerGithubId: string;
  participants: Array<{
    githubId: string; login: string; avatarUrl: string;
    state: 'lobby' | 'admitted';
    contributor: boolean;
    isHost: boolean;
  }>;
}

// drafts channel
interface DraftPayload {
  authorGithubId: string;
  authorLogin: string;
  text: string;                           // full snapshot, last-write-wins per author
  updatedAt: number;
}
```

The host maps its internal `ChatMessage` (`packages/contracts/src/rpc.ts`) to `SharedMessage` at
the transport boundary; the viewer renders `SharedMessage` directly. Version negotiation: on
connect, host and viewer exchange `v`; a viewer on an older wire version renders best-effort and
shows a "host is on a newer Panopticon" notice rather than breaking.

---

## Conversation Sharing

### Host side

- A new host module subscribes to the host's local conversation event source (the same source
  feeding `subscribeConversationMessages` / the conversation read model — see
  `src/dashboard/server/services/conversation-service.ts`).
- On viewer admit: send a `conversation` `history` backfill (the **full** conversation, read from
  the host's local store / JSONL), then stream live `append` / `update` events.
- **Full history on join** is locked — the data lives in the host's local store and the
  DataChannel can carry it. A progressive lazy-load is a future optimization, not v0.

### Viewer side

- The viewer's dashboard frontend opens a route, e.g. `/#/shared/<roomId>`, mounted when the join
  intent arrives.
- It establishes the browser `RTCPeerConnection`, renders the `conversation` channel through the
  existing conversation UI components (`ConversationPanel` / `MessagesTimeline` in
  `src/dashboard/frontend/src/components/chat/`), reusing message rendering as-is.
- The viewer's surface is **read of conversation + compose of drafts** — see *Input Model*.

### Default surface & terminal toggle

The **conversation panel** is the default shared surface. A **terminal view toggle** lets a viewer
flip to the host's live tmux pane.

- The `terminal` channel carries raw bytes from the existing `ws-terminal.ts` PTY hub — the
  WebRTC transport subscribes to `broadcastToHub()` output as an additional consumer.
- **Strictly one-directional, host → viewer.** Viewer keystrokes never reach the host's shell.
  Read-only is locked, not optional — terminal sharing is "watch me work", not "drive my shell".
  The terminal data channel has no inbound path on the host.

---

## Input Model

- **View-only by default.** A newly-admitted viewer cannot drive the conversation; they compose
  **prompt suggestions** in their own local draft box.
- **Suggestion UI — stacked list.** The controller sees every viewer's pending draft as a stacked
  list with author avatars (queue-of-questions feel) and picks one to send, optionally editing it
  first.
- **Drafts sync live as people type** — plain-text full-snapshot updates over the `drafts` channel.
  No CRDT, no rich editor in v0. Last-write-wins per draft, scoped to the author.
- **Direct-submit (contributor) permission.** The controller can grant any admitted viewer
  **direct-submit**: that viewer's prompts post straight into the conversation without the
  controller picking each one. Per-viewer, controller-granted, revocable. A viewer holding it is a
  **contributor**.
  - Direct-submit is **not** host handoff — a contributor sends prompts but cannot
    admit/kick/revoke or hand off. Many contributors may exist; there is still exactly one
    controller.
  - Direct-submit does **not** bypass the lobby. Everyone is host-admitted first (invite-only is
    non-negotiable); contributor is a second, separate grant applied after admission.

### Open question — concurrent direct-submit ordering

With multiple contributors, several humans can post prompts into one linear conversation driven by
one agent. The v0 behavior, to confirm during planning:

- **Lean:** strict FIFO queue; submissions arriving while the agent is mid-turn are queued and
  flushed when the turn ends; a soft "X is composing / agent is working" indicator discourages
  collisions.
- **Related, nice-to-have:** let the controller pre-designate a GitHub handle as **auto-contributor**
  (direct-submit granted automatically on admission) instead of promoting each viewer by hand.
  Not v0-critical.

This is the single remaining open question; it has a safe default and does not block planning.

---

## Clients & Join Paths

Two first-class clients in v0: the **dashboard** and the **CLI**. Both can host-share and join.
All join paths funnel through the same host-approval lobby.

### Dashboard

- **Host:** a "Share this conversation" action in the conversation panel calls
  `POST /api/sessions` (via the host's dashboard server) and surfaces the `/s/<shortCode>` link +
  a participant/lobby management panel.
- **Viewer:** open the link in a browser → GitHub OAuth on `panopticon-cli.com` → **localhost-detect**:
  the share page probes for a running local Panopticon at `localhost:<port>` and POSTs the join
  intent there → the local dashboard opens `/#/shared/<roomId>` → lobby.
  A `pan://` protocol handler was considered and rejected (OS-level registration is finicky
  cross-platform).

### CLI

- `pan share <conversationId>` — host side. Prints the `/s/<shortCode>` link and a short join code.
- `pan join <link-or-code>` — viewer side. Authenticates via GitHub **device flow**, posts the
  join intent straight to its own local dashboard (it already knows the local port — no
  localhost-detect needed), lands in the lobby; on admit, the shared conversation opens in that
  user's local dashboard.

### Cold start

A viewer who clicks the **browser** link with no local Panopticon running cannot be auto-helped by
the share page — a web page cannot spawn a local process. The page detects "no localhost" and
instructs the user to run `pan join <link-or-code>`. **`pan join` auto-starts the local dashboard
if it is not already running**, then proceeds to the lobby — so the CLI is the cold-start recovery
path for an installed-but-not-running viewer. A viewer with **no Panopticon installed at all** must
install it first; a hosted read-only web view for the truly-uninstalled case is a possible
followup (it would put conversation content on `panopticon-cli.com`, breaking the no-content
guarantee) and is out of scope for v0.

---

## Data Model

### Host-side persistence

The host persists a minimal record so it can re-park on the signaling room after a `pan` restart.
New SQLite table (schema bump in `src/lib/database/schema.ts`, currently version 38):

```sql
CREATE TABLE shared_sessions (
  conversation_id TEXT PRIMARY KEY,   -- FK to conversations.name
  room_id         TEXT NOT NULL,
  short_code      TEXT NOT NULL,
  host_token      TEXT NOT NULL,      -- bearer secret; never leaves the host
  mode            TEXT NOT NULL,      -- 'conversation' | 'terminal'
  status          TEXT NOT NULL,      -- 'active' | 'ended'
  created_at      TEXT NOT NULL,
  ended_at        TEXT
);
```

Participant state, contributor grants, and the block list are **not** persisted host-side — they
live in the signaling service room state (membership, not content) and the host re-reads them on
reconnect. This keeps host persistence minimal and makes auto-restore-across-restart correct.

### Signaling service

In-memory only (the `Room` struct above). No database. Documented consequence: a signaling-service
redeploy ends in-flight shares; acceptable for v0.

---

## New Error Types

Per the PAN-1249 convention, new tagged errors are added to **`src/lib/errors.ts`** (the shared
errors file PAN-1249 introduces):

```ts
export class SignalingError      extends Data.TaggedError('SignalingError')<{ readonly reason: string; readonly cause?: unknown }> {}
export class WebRtcError         extends Data.TaggedError('WebRtcError')<{ readonly stage: 'offer'|'answer'|'ice'|'datachannel'; readonly cause?: unknown }> {}
export class ShareSessionError   extends Data.TaggedError('ShareSessionError')<{ readonly reason: string }> {}
export class OAuthError          extends Data.TaggedError('OAuthError')<{ readonly provider: 'github'; readonly reason: string }> {}
export class RoomNotFound        extends Data.TaggedError('RoomNotFound')<{ readonly roomOrCode: string }> {}
export class ParticipantBlocked  extends Data.TaggedError('ParticipantBlocked')<{ readonly githubId: string }> {}
```

If PAN-658 is implemented before PAN-1249 merges, these go into `src/lib/errors.ts` on the
`feature/pan-1249` base branch. Signaling-service-internal errors (its own deployable) may define
local tagged errors in `services/signaling-service/src/errors.ts`.

---

## Security Considerations

- **Invite-only enforced in two layers:** the lobby (signaling service) and the host's own
  admitted-set gating of content channels. Neither alone is trusted.
- **Link is not a capability.** `shortCode` only routes a joiner to the lobby; it grants nothing.
- **Identity is signed.** Viewer identity is a signaling-service-signed JWT the host verifies
  against published JWKS — the host does not trust a self-asserted GitHub handle.
- **Content is end-to-end encrypted** over DTLS DataChannels and never transits the signaling
  service. Verified by an e2e test asserting the signaling WS sees no conversation bytes.
- **`hostToken` is a bearer secret** — generated by the signaling service, stored only on the host
  (`shared_sessions.host_token`), never sent to viewers, never logged.
- **TURN credentials are ephemeral** — `coturn` REST API HMAC credentials, ~10-minute TTL.
- **Terminal sharing is read-only** — the host exposes no inbound terminal path; viewer keystrokes
  are structurally impossible to deliver to the host shell.
- **Rate-limit `POST /api/sessions`** by IP on the signaling service to prevent room-spam.
- **The host dashboard remains localhost-only and unauthenticated** for its own UI — sharing does
  not expose the host dashboard to the internet; only the explicitly-shared conversation's
  channels are reachable, and only by admitted peers.

---

## Implementation Phases (sequencing within PAN-658)

All phases ship together under this issue. An optional internal scaffold — a dumb WS-relay
transport — may be used to validate UX before the WebRTC transport lands, but it is not a
shipped artifact.

| Phase | Scope |
|---|---|
| 1 | **Signaling service**: `services/signaling-service/`, room registry, GitHub OAuth (web + device flow), identity JWT, TURN credential issuance, `coturn` deploy. Testable standalone with a stub client. |
| 2 | **Host WebRTC transport**: `werift`/`wrtc` evaluation + pick, peer-connection manager, data-channel multiplexer, signaling client. Wire format in `packages/contracts/src/sharing.ts`. |
| 3 | **Access control**: lobby, admit/kick/revoke/un-revoke, block list, presence channel. Host-side content gating. |
| 4 | **Viewer side**: browser `RTCPeerConnection`, `/#/shared/<roomId>` route, conversation rendering + full-history backfill. |
| 5 | **Terminal channel**: extend the `ws-terminal.ts` hub with a WebRTC consumer; viewer terminal-view toggle (read-only). |
| 6 | **Input model**: `drafts` channel, stacked-list suggestion UI, direct-submit / contributor grants. |
| 7 | **Host role & handoff**: controller role on the room, handoff + reclaim. |
| 8 | **Lifecycle & resilience**: link revoke, 5-minute reconnect window, auto-restore, `shared_sessions` persistence. |
| 9 | **CLI**: `pan share`, `pan join` (device flow, auto-start dashboard) + wrapper skills. |
| 10 | **Cold-start handling, hardening, e2e + Playwright tests, docs.** |

---

## Acceptance Criteria

- [ ] Host can run "Share this conversation" (dashboard) and get a `panopticon-cli.com/s/<id>` link
- [ ] `pan share <conversationId>` (CLI) prints a working share link + join code
- [ ] Browser link recipient hits GitHub OAuth, then localhost-detect hands off to their local dashboard
- [ ] `pan join <link-or-code>` (CLI) authenticates via GitHub device flow and lands in the lobby
- [ ] `pan join` auto-starts the local dashboard when it is not already running
- [ ] A joiner with a valid link receives **no** conversation/draft/terminal/presence data until the controller admits them from the lobby (e2e-verified — link possession alone grants nothing)
- [ ] Controller sees pending joiners with GitHub avatar + handle in a lobby and can admit each one
- [ ] Admitted viewer's dashboard renders the host's conversation in real time, including full-history backfill on join
- [ ] Presence list shows GitHub avatars + handles of all current participants, marking the controller and the host
- [ ] Viewer can compose a prompt draft; draft updates appear live in the controller's stacked-list UI as they type
- [ ] Controller can pick a viewer's draft, optionally edit it, and send it to the conversation
- [ ] Controller can grant an admitted viewer **direct-submit** (contributor); that viewer's prompts then post straight to the conversation; the grant is revocable
- [ ] Viewer can toggle to terminal view and see the host's tmux session live; viewer keystrokes never reach the host shell
- [ ] Controller can **kick** a viewer (soft): channels torn down, "removed by host" shown; re-clicking the link re-enters the lobby; re-admittable
- [ ] Controller can **revoke** a participant (hard), connected or in the lobby: channels torn down, GitHub id added to the block list, re-clicking the link no longer reaches the lobby; controller can un-revoke
- [ ] Controller can revoke the entire share link — all viewers (lobby + admitted) are dropped
- [ ] Controller can hand off the controller role to an admitted viewer; the data owner can reclaim it at any time
- [ ] The share link stops working once the host ends the shared conversation (no fixed-duration timer)
- [ ] After a host network drop or `pan` restart, admitted viewers auto-restore without re-admission when the host returns within the 5-minute window; past the window the room tears down and re-join goes through the lobby
- [ ] Connection works through symmetric NATs via TURN relay
- [ ] Conversation events cross the data channel in the scoped, versioned wire format — not raw internal `PanRpcGroup` types
- [ ] Signaling service does not see conversation content (e2e-verified)
- [ ] New tagged errors live in `src/lib/errors.ts` per the PAN-1249 convention

## Test Plan

**Unit**
- Wire format: envelope versioning, `ChatMessage` → `SharedMessage` mapping, gap detection via `seq`
- Room state machine: lobby → admitted, kick → lobby, revoke → blockList, TTL expiry
- Identity JWT: mint, sign, verify against JWKS, reject expired / wrong-room tokens
- TURN credential HMAC generation + TTL
- `shared_sessions` table CRUD + schema migration (38 → 39)

**Integration**
- Signaling service: create room → host parks → viewer joins lobby → admit → SDP/ICE relay → data channel open
- Full join lifecycle: share → OAuth → lobby → admit → backfill → live append → kick → re-join lobby → revoke → blocked
- Host handoff: controller A → viewer B → B admits a third viewer → data owner reclaims
- Reconnect: kill host WS for < 5 min → auto-restore admitted viewers; kill for > 5 min → room torn down
- Direct-submit: grant contributor → contributor prompt posts directly → revoke grant → reverts to suggestion-only
- TURN path: force-relay configuration connects two simulated symmetric-NAT peers

**E2E / Playwright**
- Two browser contexts (host + viewer): host shares, viewer joins, host admits, viewer sees conversation update live
- Negative: viewer in lobby asserts the conversation panel is empty (no content leaked pre-admit)
- Privacy: instrument the signaling WS, assert no conversation/terminal/draft bytes ever traverse it
- Terminal toggle: viewer flips to terminal view, sees host tmux output, keystrokes produce no host-side effect

## Out of Scope (followups)

- Sharing entire **agent sessions** (watch-an-agent-with-friends) — separate issue
- Sharing kanban / inspector / other dashboard panels — v2+
- Multi-conversation sharing in one link — v2+
- Rich **collaborative markdown editing** for prompt drafts (CRDT, gist-backed) — separate issue (PAN-659 lineage); may require the `gist` OAuth scope
- **Hosted read-only web view** for viewers with no Panopticon installed — different privacy model
- Voice / video — never (use Zoom/Meet alongside)
- Persisting signaling-service room state across redeploys — v0 accepts in-flight shares ending on deploy

## Files Likely Touched

**New — signaling service**
- `services/signaling-service/` (new Bun workspace) — room registry, OAuth, JWT, TURN creds, signaling WS
- `services/signaling-service/src/errors.ts` — service-local tagged errors
- `infra/signaling/` — Fly.io + `coturn` deploy config

**New — host transport (dashboard server, Effect-native)**
- `src/dashboard/server/sharing/signaling-client.ts` — WS client to the signaling service
- `src/dashboard/server/sharing/peer-hub.ts` — `RTCPeerConnection` per viewer, data-channel mux
- `src/dashboard/server/sharing/conversation-bridge.ts` — local conversation events → `conversation` channel
- `src/dashboard/server/sharing/terminal-bridge.ts` — `ws-terminal.ts` hub → `terminal` channel
- `src/dashboard/server/sharing/access-control.ts` — admitted set, contributor grants, host-side gating
- `src/dashboard/server/routes/sharing.ts` — `/api/sessions/*`, `/api/shared/*`, join-intent endpoint

**Modified**
- `src/dashboard/server/server.ts` — register `sharingRouteLayer`
- `src/dashboard/server/ws-terminal.ts` — expose hub byte stream to the terminal bridge
- `src/lib/database/schema.ts` — `shared_sessions` table, schema 38 → 39
- `src/lib/database/` — new `shared-sessions-db.ts` accessor
- `src/lib/errors.ts` — new tagged errors (PAN-1249 base)
- `packages/contracts/src/sharing.ts` (new) + `index.ts` — wire format schemas
- `tsdown.config.ts` (server) — externalize the WebRTC dep if a native addon is chosen
- `.claude/rules/dashboard-node22-only.md` — note the WebRTC dep if native

**New — frontend**
- `src/dashboard/frontend/src/components/sharing/SharedConversationView.tsx` — viewer surface
- `src/dashboard/frontend/src/components/sharing/LobbyPanel.tsx` — controller's admit/kick/revoke UI
- `src/dashboard/frontend/src/components/sharing/SuggestionList.tsx` — stacked draft list
- `src/dashboard/frontend/src/components/sharing/ShareDialog.tsx` — host "Share this conversation" action
- `src/dashboard/frontend/src/lib/webrtc-viewer.ts` — browser `RTCPeerConnection` + channel handling
- `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx` — add the Share action

**New — CLI**
- `src/cli/commands/share.ts` — `pan share <conversationId>`
- `src/cli/commands/join.ts` — `pan join <link-or-code>` (device flow, dashboard auto-start)
- `src/cli/index.ts` — register `share` + `join`
- `skills/pan-share/SKILL.md`, `skills/pan-join/SKILL.md` — wrapper skills (Skills↔CLI convention)

**Docs**
- `docs/SHARED-SESSIONS.md` (new) — operator + user guide
- `docs/INDEX.md` — link the new doc
