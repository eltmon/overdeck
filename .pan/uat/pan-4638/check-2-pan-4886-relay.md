# PAN-4886 — the PAN-4862 live relay check on Fly

- **Commit tested:** home deployed build `65e3b1adf86` (`pan` 0.73.1). Fix under test: PAN-4862 `04f8bccc9df` (relay TURN order: TLS 443 first, no STUN), in every build since `b1d9d9dc554` and in the published 0.73.0 and 0.73.1. The relay VM runs published `@overdeck/core` 0.73.1.
- **Date:** 2026-11-04, from 10:52 UTC. Fly app `pan-workspaces`, region `iad`.
- **Relay VM:** `fly-8d4101ae001028` (machine `8d4101ae001028`, `shared-cpu-2x:2048MB`), the VM `pan machines add-fly` made for check 1, reused.
- **Method:** PRD `.pan/drafts/PAN-4882.md` WI-2 to WI-5, with the deviations listed under "Setup".

## Setup

### Why the add-fly VM, and how it was turned into a relay VM

The brief for this run says to add Fly VMs only through Overdeck, while PAN-4882 WI-2 makes the relay VM by hand with
`fly machine run`. The run reused the Overdeck-made VM from check 1 instead, and told the orchestrator conversation
before starting (`pan tell conv-20261029-6880`, 10:51 UTC). Changes from the PRD's hand-made VM:

```
# home: detach the VM from home without destroying it
$ pan machines unlink fly-8d4101ae001028 --keep-server --json          # 10:52:06
{"ok":true,"peerNotified":false,"ssh":null,"fly":{"destroyed":false}}

# VM (fly ssh console): tools, watchdog, marker config, server restart
apt-get install -y -qq iptables tcpdump tshark jq                      # apt-exit=0; TShark 4.2.2
pkill -f fly-machine-watchdog.js        # add-fly's heartbeat watchdog stops the VM 300 s after home stops heart-beating
cat /.overdeck/config.yaml              # HOME=/ on add-fly VMs, so the config lives under /.overdeck
terminal:
  backend: tmux
anywhere:
  machine:
    tags: [pan4638relaymarker]
# the provisioner's server ran with OVERDECK_PUBLIC_LINK_ONLY=1, which advertises no endpoints and answers only
# secure channels and loopback; it was replaced by a server without that flag, with the PRD's debug flags:
DEBUG='werift*' DEBUG_COLORS=0 OVERDECK_TERMINAL_BACKEND=tmux IS_SANDBOX=1 PORT=3011 \
  NODE_OPTIONS=--tls-keylog=/root/tls-keys.log nohup setsid pan serve --port 3011 --no-open > /root/serve.log 2>&1 &
# health=200; server env shows DEBUG=werift*, NODE_OPTIONS=--tls-keylog=/root/tls-keys.log, HOME=/, no OVERDECK_PUBLIC_LINK_ONLY
```

The marker is `pan4638relaymarker` (the PRD's `pan4882relaymarker`, renamed for this run). The VM has a real
Claude Code with credentials (check 1's critic ran there), so the marker conversation uses Claude Code
(Sonnet 5.5) instead of the fake harness.

Home before the run:

```
$ pan account status
Signed in as eltmon (GitHub id 678719)
Access:          active
$ pan machines directory --json | jq -c '{plan, relay, machines:[.machines[].label]}'
{"plan":"tester","relay":{"month":"2026-11","bytesUsed":0,"capBytes":50000000000,"stopped":false},"machines":["eltmon-z790"]}
```

### Device-code sign-in

| Code | Issued (UTC) | Sent to | Result |
| --- | --- | --- | --- |
| `XQBP-NTVB` | 10:52:40 | `pan tell conv-20261029-6880` at 10:52:52 | `The sign-in code expired. Run: pan account login` (seen 11:07:47) |
| `XPCG-PWVZ` | 11:08:11 | `pan tell conv-20261029-6880` at 11:08:22 (the one resend the brief allows) | `The sign-in code expired. Run: pan account login` (seen 11:23:21) |

The orchestrator received both codes and answered each time that it could not approve them: it approves
through the Claude extension in the operator's Chrome, which was not connected, so it passed the link on to the
operator. This session did not approve the codes itself; approval belongs to the orchestrator in the brief.

```
# VM, 11:24
$ HOME=/ pan account status
Not signed in. Run: pan account login
$ iptables -S
-P INPUT ACCEPT
-P FORWARD ACCEPT
-P OUTPUT ACCEPT          # no firewall rule was ever applied
```

Sign-in: not-run — two device codes expired unapproved (10:52–11:23 UTC); the orchestrator's browser extension was disconnected

## UDP blocked, AC-2 relay half, TCP 443 only

Not run. Each needs the VM linked to home through the directory, and the directory link needs the VM signed in
(the directory gives out the TURN credentials and the relay route). No firewall rule, packet capture or marker
conversation was made. The TLS key log never left the VM and was destroyed with it.

## Cleanup

```
$ fly machine destroy 8d4101ae001028 -a pan-workspaces --force
8d4101ae001028 has been destroyed
$ fly machines list -a pan-workspaces
No machines are available on this app pan-workspaces
$ fly volumes list -a pan-workspaces
 ID │ STATE │ NAME │ SIZE │ REGION │ ZONE │ ENCRYPTED │ ATTACHED VM │ CREATED AT      # empty
$ pan machines directory --json | jq -c '{relay, machines:[.machines[].label]}'
{"relay":{"month":"2026-11","bytesUsed":0,"capBytes":50000000000,"stopped":false},"machines":["eltmon-z790"]}
```

The VM was never signed in, so it held no account credentials. Home's link to it had already been removed by
`unlink --keep-server`, so `pan machines unlink` and `pan machines forget` had nothing to act on.

## Result

The PAN-4862 live relay check did not run, for the third time, and for the same reason: no one approved the
device code within its ~14-minute life. Everything up to the sign-in now runs on an Overdeck-made VM (above).
To finish it, the operator (or an orchestrator with a connected browser) must be ready to approve one code when
the run starts; then follow PAN-4882 WI-3 to WI-5.

Status: not-run — AC-2 relay half: device code not approved (two codes expired, 10:52–11:23 UTC)
Status: not-run — AC-3 relay: device code not approved (two codes expired, 10:52–11:23 UTC)
