# Restart Gate (PAN-3729)

The restart gate stops a **voluntary** dashboard restart from happening while
the operator is mid-work. Instead of restarting, the requesting process
registers a request and blocks until the operator approves it — from the
approval banner at the top of every dashboard view, or from a terminal.

## Glossary

- **Voluntary restart** — a restart a process asked for: the post-merge deploy
  script, `pan reload`, or bare `pan restart`. These are the only restarts the
  gate covers.
- **Involuntary restart** — crash recovery, watchdog respawn, supervisor
  restart-on-death. Never gated.
- **Requester** — the process that wants a restart, identified by a
  `requesterId` that is stable for one invocation (`deploy:PAN-3724:<pid>`,
  `reload:<pid>`, `restart:<pid>`).
- **Epoch** — one approval cycle: the set of request ids captured at the moment
  the operator approves. One epoch produces at most one restart.
- **Claim** — the exclusive right, granted to exactly one requester per epoch,
  to actually perform the restart. Every other member of the epoch is
  **satisfied** by that restart and skips its own.
- **Runtime plane** — non-canonical operational state (the same plane as
  `~/.overdeck/dashboard-restarting.json`). The gate file is runtime-plane: it
  is never mirrored to git and never written to the `overdeck-state` branch.

## Why coalescing matters

Three deploys finishing within a minute of each other must not restart the
dashboard three times. One approval opens one epoch over every request waiting
at that instant; one restart satisfies all of them. A request that arrives
*after* approval is not a member of that epoch — it waits for the next cycle.

## State machine

```
pending ──approve──▶ approved ──claim──▶ claimed ──(new server boots)──▶ satisfied
```

| Rule | Value | What it protects against |
| --- | --- | --- |
| Request TTL | 20s without a refresh | a requester that died keeps the banner up forever |
| Claim lapse | 5 minutes | a claimant that died between claiming and restarting |
| Satisfied retention | 10 minutes after boot | a slow poller misses its own "you're done" answer |
| Sweep interval | 5s | expiry is only visible to readers; the sweep republishes |

A **poll is the refresh** — requesters call `POST /api/restart-gate/requests`
every 5s, and that call is what keeps their request alive.

Two clearing rules keep the gate from wedging:

- Approving when every request has already expired clears the gate and restarts
  nothing. Approval must never manufacture a restart nobody is waiting for.
- An **unclaimed epoch whose members have all expired is dropped**. Without
  this, an approval whose requesters then died would leave the gate stuck in
  `approved` forever: the banner would never return (its condition is
  `pending`), and later requests could never be approved. A *live* claim is
  never dropped this way — the claimant is restarting, not polling.

  That drop also records `lastOutcome: { type: 'pruned-unclaimed', at }` on the
  projection for 15s (PAN-3731, additive — not part of the pinned PAN-3729 wire
  contract). The banner uses it to say the approval restarted nothing instead
  of silently vanishing; the notice window is measured from `at`, so a late
  connect shows only what is left of it.

## Boot resolution

On startup the server reads `~/.overdeck/restart-gate.json`:

- **Epoch in `claimed` state** → this boot IS that restart completing. Every
  requester id in the epoch is marked satisfied, the epoch is closed, and
  pending is cleared. Those requesters get `satisfied` on their next poll and
  exit successfully without restarting anything themselves.
- **Epoch in `approved` state (unclaimed)** → nobody performed a restart for
  it, so it is left alone. Its members keep waiting and can still claim.

A restart taken outside the gate — `pan restart --now`, a crash, a watchdog
respawn — does *not* satisfy waiting requests, because no claimed epoch is on
disk to resolve. Those requesters re-register on their next poll and appear in
the banner again; approving them costs one more restart. The dashboard's own
restart button is the exception: see "Implicit approval" below.

## Wire contract

All endpoints live on the dashboard server (`:3011`). Shapes are pinned.

### `POST /api/restart-gate/requests`

Upsert, poll, and TTL-refresh in one call. Requesters call it every **5s**
while waiting.

```jsonc
// request
{ "requesterId": "deploy:PAN-3724:4211", "kind": "deploy", "reason": "post-merge deploy PAN-3724", "builtSha": "abc1234" }
// response 200
{ "status": "pending" | "approved" | "claimed" | "satisfied", "mayClaim": false, "pendingCount": 2 }
```

- `satisfied` → the restart this requester wanted already happened. Skip your
  own restart step and exit success.
- `approved` with `mayClaim: true` → you may try to claim.
- `kind` must be `deploy`, `reload`, or `restart`; anything else is a 400.

### `POST /api/restart-gate/claim`

```jsonc
// request
{ "requesterId": "deploy:PAN-3724:4211" }
// response 200
{ "granted": true, "status": "claimed" }
```

Exactly one grant per epoch. The transition is synchronous inside the single
writer, so two simultaneous claims are serialized and one loses. A claimant
re-claiming its own live claim is granted again, so retrying after a dropped
response is safe. After the 5-minute lapse the next poller may take it.

### `POST /api/restart-gate/approve`

No body. Operator-only surface — the banner button and `pan restart approve`.

```jsonc
{ "approved": true, "pendingCount": 2 }
```

`pendingCount: 0` means every request had already expired; the gate was
cleared and nothing will restart.

### `GET /api/restart-gate`

The read door.

```jsonc
{
  "status": "idle" | "pending" | "approved" | "claimed",
  "pending": [
    { "requesterId": "reload:4211", "kind": "reload", "reason": "pan reload", "builtSha": "abc1234", "requestedAt": "2026-08-14T12:00:00.000Z" }
  ]
}
```

### Compat rule

If a gate endpoint returns **404**, or the dashboard health endpoint fails
continuously for **60s**, the requester proceeds **ungated** with its normal
restart. This is what lets the gate itself ship through a server that predates
it, and a dead dashboard has no operator work to interrupt.

## Exempt paths — never gated

| Path | Why |
| --- | --- |
| Supervisor `POST /restart-dashboard` (`src/supervisor/server.ts`) | It is the mechanism an approved restart uses. Gating it would deadlock. |
| `pan restart --now` | The explicit operator bypass. |
| Watchdog respawn / crash recovery / restart-on-death | Involuntary — there is no operator decision to wait for. |
| The dashboard's own restart button | Implicit approval (below). |

## Implicit approval from the dashboard restart button

`POST /api/system/restart-dashboard` (App.tsx fallback, UpdateDialog) counts as
approval. Before spawning the restart it folds every waiting request into an
epoch claimed by `dashboard-ui:<pid>`, so the next boot marks those requesters
satisfied and they unblock instead of waiting for an approval that already
happened. It spawns `pan restart --dashboard --now`: without `--now` the
spawned CLI would register its own request, find a claimed epoch it is not a
member of, and block forever.

## Where the code lives

| Piece | File |
| --- | --- |
| Gate state machine, persistence, boot resolution, sweep | `src/dashboard/server/services/restart-gate.ts` |
| The four routes | `src/dashboard/server/routes/restart-gate.ts` |
| Boot init (`initRestartGate`) | `src/dashboard/server/main.ts` |
| Read-model field + event | `packages/contracts/src/types.ts`, `events.ts`, `event-reducers.ts` |
| Snapshot exposure | `src/dashboard/server/read-model.ts` |
| Approval banner | `src/dashboard/frontend/src/components/RestartApprovalBanner.tsx` |
| Shared CLI/script client | `src/lib/restart-gate-client.ts` |

## Doors and planes

`services/restart-gate.ts` is the **one read door and the one write door** for
gate state. No route handler, CLI, or script opens `restart-gate.json` itself.
The gate is runtime-plane, so it never mirrors to git — but the two-doors
structure still applies, because two writers over one file is how the state
model drifts.

The dashboard learns about the gate through the **read model**, never by
polling: the gate publishes a `restart_gate.changed` event carrying the
complete projection, the read-model reducer replaces `restartGate` with it, and
`/ws/rpc` fans it out. The connect snapshot carries the same field so a browser
reload is consistent with the event stream. The event is emitted with
`emitOnly` — in-memory fan-out, never appended to the durable event log —
because the gate is runtime-plane state that is rebuilt from the file at boot.
