# PAN-4774 — AC-3 direct and UDP-blocked routes, AC-2 relay half

- **Commit tested:** home dashboard at deployed integrated main (build `194adf91f96`, `pan` 0.72.0); the VM ran `registry.fly.io/pan-workspaces:pan-4774` (this branch's packed `@overdeck/core` 0.72.0).
- **Date:** 2026-11-02, 22:37–23:00 UTC. Fly machine `829399a7720718` (`pan4774-relay`, `shared-cpu-1x`, 2 GB, `iad`), created with `fly machine run`, never with `add-fly`.
- **Account:** home signed in as `eltmon`; `pan machines directory --json` → plan `tester`, relay cap 50 GB, `bytesUsed` 0, only `eltmon-z790` registered (D-8: one directory registration at a time).

## Setup

1. On the VM: `pan serve --port 3011 --no-open` started by hand (`HOME=/root`).
2. `pan account login` on the VM printed `VKFV-JTCQ`; sent with `pan tell conv-flywheel "PAN-4774 device code VKFV-JTCQ https://account.overdeck.ai/activate?user_code=VKFVJTCQ …"`; the Flywheel approved it and the VM printed "Signed in to https://account.overdeck.ai as eltmon (device Linux device, 0c606ad8-…)".
3. VM: `pan machines join --to eltmon-z790 --json` → `{"requestId":"e18029de…","sas":"035 236","fingerprint":"da4f-8c0c-2c16-a4de-a128","approver":"eltmon-z790"}`. Home: `pan machines approve e18029de… --yes` → "Code: 035 236 · fingerprint 0978-a6df-675a-1091-af4c … Approved." VM: `pan machines accept e18029de…` → "Accepted." Both screens showed `035 236`.

## Direct route (Tailscale absent on both) — passed

```
$ pan machines list --json   # on home, within 5 s of the accept
online rtc://d26aef3f-5632-4d32-964d-ca1b7f7d066d
routes: lan tcp://172.19.31.10:3011 (advertised, unreachable), lan tcp://172.19.31.11:3011 (advertised, unreachable),
        direct rtc://d26aef3f-… (directory, current), relay rtc+turn://d26aef3f-… (directory, untried)
```

Tailscale is not installed on this host, and the VM image has none.

## UDP blocked — failed, filed [#4862](https://github.com/eltmon/overdeck/issues/4862)

Inside the VM (both `iptables` and `ip6tables`): `-A OUTPUT -p udp --dport 53 -j ACCEPT`, `-A INPUT -p udp --sport 53 -j ACCEPT`, `-A OUTPUT -p udp -j DROP`, `-A INPUT -p udp -j DROP`. Then `POST /api/machines/00c58fd8-…/reconnect` on home. After 3 min 19 s the link was `offline` with every route `unreachable`:

```
rtc://…: Secure channel … did not open within 10000 ms; rtc+turn://…: Secure channel … did not open within 10000 ms
```

**Cause.** The VM's server, restarted with `DEBUG=werift*`, logged on each relay attempt:

```
werift:packages/webrtc/src/utils.ts iceOptions { turnServer: [ 'turn.cloudflare.com', 3478 ], turnTransport: 'udp', … }
```

werift 0.25.1 `parseIceServers` keeps only the first TURN URL and its transport; the connect service passes Cloudflare's list in order, UDP first. The `transport=tcp` and `turns:` URLs are never used, so a network that blocks UDP cannot use the relay. The account is relay-eligible (plan `tester`, 50 GB cap, TURN allocation succeeded), so this is a failure, not an approximation. The "No direct path; install Tailscale or use the relay plan" message did not appear.

**Control (unexplained).** UDP allowed only to the TURN server (`141.101.90.1`, `2a06:98c1:3200::1`) and Cloudflare's relay range `104.30.0.0/16`: the VM's allocation succeeded (`turn candidateAddress [ '104.30.148.172', 44209 ]`), home's relay candidate arrived (`104.30.136.140:60426`, type `relay`), but every pair check failed (`CandidatePairState.FAILED … ICE failed`) and the link stayed offline for 90 s. Not root-caused; recorded in #4862 as an observation. The status card never showed **Using relay**, and `relay.bytesUsed` stayed 0.

## AC-2 relay half — not shown

`tcpdump -i any -w /tmp/relay.pcap` ran on the VM through the control run with the marker tag `pan4774relaymarker` in the VM's `anywhere.machine.tags`. Because the relay never connected, no link traffic crossed it: the capture holds 84 UDP packets to the TURN addresses (allocation and failed checks), the marker 0 times, and 10 `HTTP/1.1` strings from the VM's own loopback health checks (`-i any` includes `lo`). This capture is not evidence for or against plaintext on the relay; AC-2's relay half waits on #4862. The local half passed ([local-smoke.md](local-smoke.md), `no-http`).

## Cleanup

VM `pan account logout` → "Signed out. This machine's device token was revoked." Home: `pan machines unlink 829399a7720718`, `pan machines forget 829399a7720718` → "Removed 829399a7720718 from the directory." `pan machines directory --json` → machines `['eltmon-z790']`, no approvals, no joins, relay `bytesUsed` 0. `fly machine destroy 829399a7720718 --force` → destroyed; `fly machines list -a pan-workspaces` → "No machines are available".

Status: failed — https://github.com/eltmon/overdeck/issues/4862 (direct route passed; AC-2 relay half not shown)
