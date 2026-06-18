# External Event Stream

**Overdeck's public event feed for third-party integrations.**

> **Status: implemented.** The `/events/stream` SSE endpoint is live at `GET /events/stream`. See `src/dashboard/server/routes/events.ts` for the implementation.

---

## Why This Exists

Overdeck's dashboard consumes a rich internal event stream: agent lifecycle, workspace transitions, activity log entries, specialist pipeline state, dashboard restarts, and more. The internal transport is **Effect RPC over WebSocket** at `/ws/rpc` — beautifully typed for the dashboard, but a hard dependency for any external process that wants to react to what pan is doing (a TTS daemon, a desk lamp, a phone notification bridge, a Prometheus exporter, a Slack forwarder).

External integrations need something simpler: a plain stream of JSON events that any language can consume with two lines of code. This doc defines that surface.

## Design Goals

1. **Language-agnostic** — any tool that can read HTTP (curl, Python, Node, Bash) can subscribe.
2. **Append-only, resumable** — events have monotonic `sequence` numbers; consumers can resume after disconnects.
3. **Filterable** — subscribers declare what they care about to avoid parsing the whole firehose.
4. **Local-only by default** — no network exposure without explicit opt-in.
5. **Stable contract** — the event shapes external tools depend on are promoted to a documented public catalog and versioned.
6. **Zero new storage** — reads directly from the existing SQLite event store; adds no new persistence or background workers.

## Transport: Server-Sent Events

The external stream is exposed as **SSE at `GET /events/stream`**.

SSE is the right fit because:

- It is one-way (server → client), matching an append-only log.
- It is plain HTTP, so firewalls, reverse proxies, and simple clients all work without special handling.
- The `EventSource` standard defines `Last-Event-ID` for resume, which maps perfectly onto our sequence numbers.
- The dashboard server already uses SSE for other streaming responses (`src/dashboard/server/routes/issues.ts:670`, `src/dashboard/server/routes/specialists.ts:1594`), so no new patterns are introduced.

A raw WebSocket endpoint was considered and rejected — it offers bidirectionality we do not need, and costs us EventSource's built-in auto-reconnect and resume semantics.

## Endpoint

```
GET /events/stream
```

### Query Parameters

| Param     | Type     | Description |
|-----------|----------|-------------|
| `types`   | CSV      | Comma-separated list of event types to include. Omit for all types. Example: `types=activity.entry,agent.output_received` |
| `sources` | CSV      | Filter `activity.entry` events by `payload.source`. Example: `sources=merge-agent,cloister` |
| `issueId` | string   | Filter to events whose payload carries this `issueId`. Example: `issueId=PAN-537` |
| `since`   | integer  | Replay events from this sequence number onward before tailing live. Equivalent to sending `Last-Event-ID`. |

Filters are AND-combined. Unknown query params are ignored.

### Headers

| Header              | Direction | Purpose |
|---------------------|-----------|---------|
| `Last-Event-ID`     | request   | Standard SSE resume — server replays from `<id>+1`. Overrides `?since=`. |
| `Authorization`     | request   | Optional `Bearer <token>` when `OVERDECK_EVENTS_TOKEN` is set. |
| `Content-Type`      | response  | `text/event-stream` |
| `Cache-Control`     | response  | `no-cache` |
| `Connection`        | response  | `keep-alive` |

### Frame Format

Each event is emitted as a standard SSE frame:

```
event: activity.entry
id: 18423
data: {"type":"activity.entry","sequence":18423,"timestamp":"2026-04-12T14:22:08.103Z","payload":{"id":"01HX...","source":"merge-agent","level":"success","message":"PAN-537 merged","issueId":"PAN-537"}}

```

- `event:` — the Overdeck event type (e.g. `activity.entry`). Consumers that only care about one type can use `eventSource.addEventListener('activity.entry', ...)`.
- `id:` — the SQLite sequence number. `EventSource` stores the latest and replays it as `Last-Event-ID` on reconnect automatically.
- `data:` — a single-line JSON object matching the `DomainEvent` schema in `@overdeck/contracts` (see `packages/contracts/src/events.ts`).

On initial connect, the server sends a keepalive comment every 15 s (`:\n\n`) so idle proxies do not close the connection.

## Authentication & Network Exposure

- **Default binding: `127.0.0.1` only.** The endpoint is not reachable from the LAN unless the dashboard is already exposed.
- **Optional bearer token:** set `OVERDECK_EVENTS_TOKEN=<secret>` in `~/.overdeck.env`. When set, the endpoint requires `Authorization: Bearer <secret>`. When unset, any local process can subscribe.
- **No per-event ACLs.** Subscribers receive the full public event catalog. If you need to hide sensitive fields, redact at the emission site, not here.

Rationale: the primary use case is local sidecars on the same machine as pan. Anything cross-host should tunnel over existing infrastructure (Tailscale, Cloudflare tunnel, SSH forward) rather than reinvent auth here.

## Public Event Catalog

External subscribers may only depend on events in the **public catalog**. Events outside this list exist and will be streamed, but may change shape without notice.

| Type                             | Purpose                                      | Replayable | Payload highlights |
|----------------------------------|----------------------------------------------|------------|--------------------|
| `activity.entry`                 | Human-readable activity log line             | yes        | `source`, `level`, `message`, `details?`, `issueId?` |
| `activity.updated`               | Legacy aggregate activity event              | yes        | `events[]` (deprecated — prefer `activity.entry`) |
| `agent.started`                  | Agent lifecycle: started                     | yes        | `agentId`, `issueId` |
| `agent.stopped`                  | Agent lifecycle: stopped                     | yes        | `agentId`, `reason` |
| `agent.output_received`          | Agent stdout lines                           | **no — live only** | `agentId`, `lines[]` |
| `workspace.created`              | Workspace provisioned                        | `issueId`, `path` |
| `workspace.destroyed`            | Workspace torn down                          | `issueId` |
| `issue.status_changed`           | Tracker status transition                    | `issueId`, `from`, `to` |
| `dashboard.lifecycle_started`    | Dashboard restarting                         | `reason`, `trigger` |
| `dashboard.lifecycle_completed`  | Dashboard restart finished                   | `reason`, `durationMs` |
| `dashboard.lifecycle_failed`     | Dashboard restart failed                     | `reason`, `error` |

Canonical schemas live in `packages/contracts/src/events.ts`. The catalog above is promoted from that file; promotions require a PR that also updates this doc and adds a row to the table.

### Stability policy

- **Additive changes** (new optional fields, new event types) may happen in any minor release.
- **Breaking changes** (field removal, type rename, required-field changes) require a major bump of the external-stream protocol version, exposed via `GET /events/version`.
- Events not in the catalog are **unstable** — consume at your own risk.

## Retention & Replay

- The event store retains events for **7 days** (`src/dashboard/server/event-store.ts`). Replay via `?since=` or `Last-Event-ID` only works within that window. Older sequence numbers receive a `410 Gone`.
- **`agent.output_received` is live-only.** It is streamed in real time to connected clients, but it is **not persisted** and will **not** appear in `?since=` or `Last-Event-ID` replay. Consumers that need historical terminal output should read the agent's tmux session directly.
- Consumers that need longer retention must persist their own state.
- On reconnect with `Last-Event-ID`, the server replays any missed events (up to the retention window) before resuming the live tail, so at-least-once delivery is guaranteed across transient disconnects for replayable event types.
- No deduplication is performed — if a sidecar crashes mid-event, it may receive the same event twice on reconnect. Consumers should be idempotent or track the last `sequence` they processed.
- **Replay is capped at 1000 events per connection.** If a consumer's gap exceeds the cap, the server skips the oldest events and emits an SSE comment like `: replay truncated, skipped N events` before tailing. The cap exists because `since=0` against a multi-day store would otherwise OOM the dashboard. Bulk historical export should use a pagination API (not yet implemented), not live SSE replay.

## Backpressure

- The server buffers outbound frames in-memory per subscriber. If a consumer cannot keep up, the connection is closed with a `slow-consumer` error frame — the consumer should reconnect with `Last-Event-ID` and either increase its processing rate or tighten its filters.
- No rate limiting is applied to well-behaved consumers. A consumer that rapidly reconnects in a loop will be subject to the dashboard server's existing connection limits.

## Example Consumers

### Bash / curl

```bash
curl -N -H "Accept: text/event-stream" \
  "http://127.0.0.1:3000/events/stream?types=activity.entry"
```

### Python (sseclient-py)

```python
import sseclient, requests, json

resp = requests.get(
    "http://127.0.0.1:3000/events/stream",
    params={"types": "activity.entry", "sources": "merge-agent,cloister"},
    stream=True,
    headers={"Accept": "text/event-stream"},
)
for msg in sseclient.SSEClient(resp).events():
    event = json.loads(msg.data)
    print(event["payload"]["message"])
```

### Node (EventSource)

```ts
import { EventSource } from 'eventsource';

const es = new EventSource('http://127.0.0.1:3000/events/stream?types=activity.entry');
es.addEventListener('activity.entry', (e) => {
  const event = JSON.parse(e.data);
  console.log(event.payload.message);
});
```

## First-Party Sidecar: `pan-tts`

The reference consumer is `pan-tts` — a local Qwen3-TTS daemon that reads new `activity.entry` events and speaks them through the user's default audio output. See the `pan-tts` skill for the recipe. `pan-tts` is optional; no part of the pan core depends on it.

## Implementation Notes (for the route author)

When this contract is implemented, the route should live at `src/dashboard/server/routes/events.ts` and follow the existing SSE pattern established by `specialists.ts:1531`:

1. Build a `ReadableStream<Uint8Array>` whose `start(controller)` does:
   - Parse `since` / `Last-Event-ID` and, if present, call `eventStore.readFrom(sequence)` to enqueue missed events.
   - Subscribe to `eventStore.streamEvents` (Effect Stream) and enqueue each event as an SSE frame, applying filters in-memory.
   - Emit a `:\n\n` keepalive comment every 15 s.
2. Wrap with `Stream.fromReadableStream` and return via `HttpServerResponse.stream(effectStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })`.
3. Register the route in `server.ts` alongside the other routes. Bind to `127.0.0.1` at the server level — do not add per-route network checks.
4. Add a `GET /events/version` route returning `{ version: 1, catalog: [...] }` for capability discovery.
5. Unit-test the filter logic; integration-test with a fake event store that appends a handful of events and asserts the consumer receives the expected subset.

No blocking FS or exec calls in the handler — standard dashboard-server rules apply (`CLAUDE.md`, `.claude/rules/no-execsync-server.md`).
