# PAN-4882 — AC-2 relay half and AC-3 relay: the PAN-4862 live relay check on Fly

- **Commit tested:** home deployed build `b1d9d9dc554` (`pan` 0.73.0); fix under test PAN-4862 `04f8bccc9df`
  (relay TURN order: TLS 443 first, no STUN). The relay VM runs published 0.73.0 (`7de98491242`, tag `v0.73.0`),
  which contains `04f8bccc9df`.
- **Date:** 2026-11-03, 06:31–07:34 UTC. Fly app `pan-workspaces`, region `iad`.
- **Relay VM:** `pan4882-relay`, machine `874235c0e259e8`, `shared-cpu-1x:2048MB`.

## Setup

```
$ fly machine run registry.fly.io/pan-workspaces:latest -a pan-workspaces --region iad --vm-memory 2048 \
    --vm-cpus 1 --vm-cpu-kind shared --name pan4882-relay --detach
Image: registry.fly.io/pan-workspaces:latest@sha256:73e7f4fcad677fc0d52088e9b22dbdf18e7488fc8ec2d9611a4bafbd37cbec38
 Machine ID: 874235c0e259e8
Machine started

# on the VM (fly ssh console): the image has no `pan` (`sh: 1: pan: not found`), node /usr/bin/node v22.23.4
#   apt-get install -y -qq iptables tcpdump tshark tmux jq          → apt-exit=0
#   npm install -g @overdeck/core@0.73.0                           → npm-exit=0; pan --version → 0.73.0
#   fake harness → /root/fakebin (tests/helpers/anywhere/fake-claude.ts, node /usr/bin/node,
#     input log /root/fake-claude-input.log); PATH=/root/fakebin:$PATH claude --version → 2.1.0 (Claude Code)
$ cat /root/.overdeck/config.yaml                                   # D-8, D-18
terminal:
  backend: tmux
anywhere:
  machine:
    tags: [pan4882relaymarker]
$ HOME=/root PATH=/root/fakebin:$PATH DEBUG='werift*' DEBUG_COLORS=0 OVERDECK_TERMINAL_BACKEND=tmux \
    NODE_OPTIONS=--tls-keylog=/root/tls-keys.log nohup setsid pan serve --port 3011 --no-open > /root/serve.log 2>&1 &
$ curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:3011/api/health
200
$ grep -m1 tls-keylog /root/serve.log
(node:1609) Warning: Using --tls-keylog makes TLS connections insecure by writing secret key material to file /root/tls-keys.log
$ getent ahosts turn.cloudflare.com | awk '{print $1}' | sort -u     # D-7 capture filter, resolved 07:2x
141.101.90.1
2a06:98c1:3200::1
```

### Device-code sign-in (D-3)

Only the relay VM signs in. Each `pan account login` ran detached on the VM with output in `/root/login*.log`, and
each code went to the Flywheel with `pan tell conv-flywheel` (run outside the Bash sandbox). The Flywheel
acknowledged the run at 06:30 and said the operator approves the codes.

| Code | Issued (UTC) | `pan tell conv-flywheel` text (codes and URLs only) | Result |
| --- | --- | --- | --- |
| `SHJC-RFDS` | 06:36:51 | `PAN-4882 device code SHJC-RFDS https://account.overdeck.ai/activate?user_code=SHJCRFDS (signs in the relay VM pan4882-relay). …` | `The sign-in code expired. Run: pan account login` |
| `VSVP-NJXJ` | 06:55:09 | `PAN-4882 device code VSVP-NJXJ https://account.overdeck.ai/activate?user_code=VSVPNJXJ (signs in the relay VM pan4882-relay). …` | `The sign-in code expired. Run: pan account login` |
| `LJVW-TZKT` | 07:16:58 | `PAN-4882 device code LJVW-TZKT https://account.overdeck.ai/activate?user_code=LJVWTZKT (signs in the relay VM pan4882-relay). … Status: relay VM device code still unapproved (40 min); AC-4, AC-6 and AC-15 are finished and passed. …` | `The sign-in code expired. Run: pan account login` (seen 07:32:01) |

```
$ HOME=/root pan account status          # 07:34
Not signed in. Run: pan account login
$ HOME=/root pan machines list
No linked machines. …
Inbound: no machine links to this one.
```

The `flywheel-orchestrator` agent named in D-3 was not running (`Error: Agent flywheel-orchestrator not running` at
06:29), so the 30-minute status note went to `conv-flywheel` with the third code.

**Detection gaps in this run.** The first approval watcher tested `pgrep -f "pan account login"` over
`fly ssh console`, which matched its own `sh -c` command line, so it never saw the first code expire; the expiry was
found by reading `login.log` at 06:54. The second watcher's filter did not trip on the expiry line either; the expiry
was found at 07:16. Neither gap could have lost an approval: an approved code ends `pan account login` with a
sign-in that `pan account status` would show, and every check of `login.log` showed expiry, not approval.

D-3's end condition holds at 07:34: every item outside the relay chain (AC-4, AC-6, AC-15) is done, and three codes
expired unapproved over 57 minutes (06:36:51–07:32:01; the last code was issued at 07:16:58). The operator's local
time was about 01:30–02:30. So the four relay items are recorded as `not-run` and the relay VM is torn down.

Sign-in: not-run — device code not approved after 57 min (three codes expired)

## UDP blocked

Not run. Outcomes A and B need the relay VM linked to home, and the link needs the VM signed in to overdeck.ai
(the directory carries the TURN credentials and the relay route). No `iptables` or `ip6tables` rule was ever applied
on the VM, so no D-9 revert timer exists. No reconnect was posted, no relay dial time exists, and no
`ac-03-using-relay.png` was taken.

UDP blocked: not-run — device code not approved after 57 min

## AC-2 relay half

Not run. No relay channel ever opened, so there was no relay traffic to capture. No `tcpdump` ran, no
`/root/relay.pcap` exists, and no conversation carrying the marker was created on the VM. The TLS key log
`/root/tls-keys.log` never left the VM and is destroyed with it in "Cleanup".

AC-2 relay half: not-run — device code not approved after 57 min

## TCP 443 only

Not run, for the same reason as "UDP blocked": without a sign-in there is no link to reconnect over a TCP-443-only
firewall. No firewall rule was applied.

TCP 443 only: not-run — device code not approved after 57 min

## Cleanup

```
$ fly ssh console … -C "sh -c 'pkill -f \"pan account login\"; HOME=/root pan account logout'"
Error: ssh shell: Process exited with status 4294967295
```

`pkill -f` matched its own `sh -c` command line and ended the session before `pan account logout` ran. The VM was
never signed in (`pan account status` → `Not signed in` at 07:34), so it held no account credentials, and it was
destroyed next. Home never linked to it, so `pan machines unlink` and `pan machines forget` had nothing to act on.

```
$ pan machines list --json | jq -c '{links: [.links[].label], inbound: [.inbound[]?.label]}'
{"links":[],"inbound":[]}
$ fly machine destroy 874235c0e259e8 -a pan-workspaces --force
874235c0e259e8 has been destroyed
$ fly machines list -a pan-workspaces
No machines are available on this app pan-workspaces
$ fly volumes list -a pan-workspaces
 ID │ STATE │ NAME │ SIZE │ REGION │ ZONE │ ENCRYPTED │ ATTACHED VM │ CREATED AT       # empty
$ pan machines directory --json | jq -c '{plan, machines: [.machines[].label]}'
{"plan":"tester","machines":["eltmon-z790"]}
```

The TLS key log and the VM's internal token were destroyed with the VM; neither was copied off it.

## Result

The PAN-4862 live relay check did not run for the second time. Its fix (`04f8bccc9df`) is in the deployed build and
the published 0.73.0, and is covered by unit tests only. To replay it, run the Setup above on a fresh VM while the
operator is available to approve the code within its ~14 min life, then follow PRD `.pan/drafts/PAN-4882.md`
WI-3 to WI-5.

Status: not-run — AC-2 relay half: device code not approved after 57 min (three codes expired)
Status: not-run — AC-3 relay: device code not approved after 57 min (three codes expired)
