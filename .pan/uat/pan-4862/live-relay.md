# PAN-4862 — Live UDP-blocked relay check (WI-4)

Status: superseded — re-run in PAN-4882 (not-run: device codes unapproved), see .pan/uat/pan-4882/ac-02-03-relay.md and #4886

The live check never reached the UDP-blocked step. The Fly VM was built and started, but its
`pan account login` device code was never approved, so the VM could not sign in to the relay-plan
account or join home. On the Flywheel's instruction (00:33 UTC), the VM was destroyed rather than left
idle. If the operator approves later, the Flywheel will ask for the check to be re-run as a follow-up.
The PAN-4774 AC-3 re-run is also a backstop.

## Outcome A — TLS allocation

Not run. No `iceOptions` line was captured on a UDP-blocked VM.

## Outcome B — channel open

Not run. The VM never joined home, so no relay link was attempted.

## What was done (2026-11-03 UTC)

- **Image:** `registry.fly.io/pan-workspaces:pan-4862`, digest
  `sha256:b7b0d870ceb23b279faff3f1cf72d68915ae5c22d42c2004f5d40ce340d065c0`. It is
  `registry.fly.io/pan-workspaces:pan-4774` plus `iptables` and this branch's packed `@overdeck/core`
  0.72.0 (branch HEAD after the `relay-docs` commit). Checked inside the image: `turnUrlRank` appears in
  `@overdeck/core/dist/dashboard/server.js`, and `iptables` and `ip6tables` are installed. The image tag
  is kept in the registry for the follow-up run.
- **VM:** Fly machine `784ee73eb54138` (`pan4862-relay`, `shared-cpu-1x`, 2 GB, `iad`), created with
  `fly machine run`. `HOME=/root DEBUG=werift* pan serve --port 3011 --no-open` answered
  `GET /api/health` with 200.
- **Sign-in:** `pan account login` on the VM printed `JNTJ-SDHK` at 00:18 UTC. The code was sent to the
  Flywheel (`pan tell conv-flywheel`). The Flywheel's device-code authority covered only PAN-4774, so it
  asked the operator. The code expired unapproved at 00:32 UTC ("The sign-in code expired").

## Planned deviation for the follow-up run

Home stays on the deployed main build; only the VM runs the branch build. Work agents may not restart the
host dashboard. The fix changes behaviour only on the end whose UDP is blocked, and home's UDP is open,
so home's ICE list works either way. To exercise both branch code paths, the follow-up should reconnect
twice per variant: `POST /api/machines/<link>/reconnect` on home (the VM runs `RtcTransport.accept`)
and the same request on the VM's own `localhost:3011` (the VM runs `RtcTransport.create`).

Pre-check done for the follow-up: werift 0.25.1 has a TLS TURN client (`TlsTransport`, `tls.connect`
with the URL's host name, so certificate checks use `turn.cloudflare.com`). An Outcome A failure would
not be caused by missing TLS support.

## Cleanup

- VM: never signed in and never joined, so no `pan account logout`, `pan machines unlink` or
  `pan machines forget` was needed.
- `fly machine destroy 784ee73eb54138 -a pan-workspaces --force` → "784ee73eb54138 has been destroyed".
  `fly machines list -a pan-workspaces` → "No machines are available on this app pan-workspaces".
- Home `pan machines directory --json` → machines `['eltmon-z790']`, no approvals, no joins.
