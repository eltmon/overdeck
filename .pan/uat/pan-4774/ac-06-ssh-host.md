# PAN-4774 — AC-6: add and remove an SSH host from a browser

- **Commit tested:** home dashboard at deployed integrated main (build `194adf91f96`, `pan` 0.72.0). The SSH host was a Fly VM (`811d32dbd41258`, `shared-cpu-1x`, 2 GB, app `pan-workspaces`, `iad`) from `registry.fly.io/pan-workspaces:pan-4774`, which carries this branch's packed `@overdeck/core` 0.72.0 (Node 22, `pan` on the login `PATH`) — `pan --version` on the host must equal home's, and does.
- **Date:** 2026-11-02, 22:27–22:44 UTC.
- **Browser:** Playwright 1.63 Chromium (headless), own `userDataDir` at `.tmp/pan-4774/pw-ac06`, home dashboard `http://127.0.0.1:3011/settings` signed in with the `#overdeck_token=` link, Settings → **Anywhere** → Machines → **Add an SSH machine**, host `ssh://root@127.0.0.1:10022`.

## Setup and deviations from D-9

- `openssh-server` installed on the VM and started as `/usr/sbin/sshd -p 2222`, reached with `fly proxy 10022:2222 811d32dbd41258.vm.pan-workspaces.internal -a pan-workspaces`. **Deviation:** D-9 named `fly proxy 10022:22`, but port 22 on a Fly VM's private address is Fly's own SSH endpoint (the one `fly ssh console` uses), which refused the key (`Permission denied (publickey)`); a debug sshd on 2222 accepted the same key at once.
- **Deviation (identity):** the dashboard's SSH runs with `BatchMode=yes` and its `SSH_AUTH_SOCK` is gpg-agent, which held no identities; `ssh-add` of the throwaway key into gpg-agent waited on a passphrase prompt (killed after 15 s, no pinentry left behind). So the throwaway ed25519 key (generated under `.tmp/pan-4774/ssh/`, authorized only on the VM) was placed at `~/.ssh/id_ed25519` for the run, with the VM's host key in `~/.ssh/known_hosts` for `[127.0.0.1]:10022`. Both were removed afterwards; no `~/.ssh/config` edit.

## Case 1 — Overdeck starts the server: failed, filed [#4861](https://github.com/eltmon/overdeck/issues/4861)

| Step | Result |
| --- | --- |
| Add | `POST /api/machines/ssh` 200; link `811d32dbd41258`, route `tcp://127.0.0.1:35457` (`kind: ssh`), `ssh.launch: managed`. The row read **Online** · "via ssh · tcp://127.0.0.1:35457 · Operator-level · Overdeck 0.72.0 · heartbeat just now … SSH ssh://root@127.0.0.1:10022 · forward up · Started by Overdeck" ([ac-06-case1-online.png](ac-06-case1-online.png), also saved as [ac-06-online.png](ac-06-online.png)). The VM ran `dashboard/server.js` (pid 1856), `supervisor/server.js` (1984), herdr and tmux, started by `pan up`. |
| Remove | Dialog ([ac-06-case1-remove-dialog.png](ac-06-case1-remove-dialog.png)): "Overdeck started the server on ssh://root@127.0.0.1:10022. Removing this machine stops that server." with "Leave the server running" unchecked → **Remove**. Home's link list became `[]` and pid 1856 exited. |
| Server stopped? | **No.** 30 s later the VM ran `supervisor/server.js` (1984, still), a new `dashboard/server.js` (pid 2639, 26 s old) and its deacon; `curl 127.0.0.1:3011/api/health` → `{"status":"ok", … "pid":2639 …}`; the launch marker `/root/.overdeck/ssh-launch/server.json` was gone. The helper's stop signals only the dashboard pid (`stopLocked`, `src/lib/anywhere/ssh/helper.ts`, D-4404-8 "sidecars that `pan up` started are left running"), and the `pan up` supervisor restarts the dashboard. (`pgrep -f 'pan serve'` prints nothing in this case, because `pan up` never runs `pan serve`, so that check alone would have passed.) |

## Case 2 — a server started by hand: passed

| Step | Result |
| --- | --- |
| Start by hand | On the VM, everything from case 1 stopped, then `OVERDECK_TERMINAL_BACKEND=tmux nohup setsid pan serve --port 3011 --no-open` → `pan serve` pid 3080, dashboard pid 3091, `/api/health` ok. |
| Add | `POST /api/machines/ssh` 200, `ssh.launch: external`; the row read **Online** · "… SSH ssh://root@127.0.0.1:10022 · forward up · Already running" ([ac-06-case2-online.png](ac-06-case2-online.png)). |
| Remove | Dialog ([ac-06-case2-remove-dialog.png](ac-06-case2-remove-dialog.png)): "The server on ssh://root@127.0.0.1:10022 keeps running." (no stop option, the `external` reason) → **Remove**. Home's link list → `[]`. |
| Server still runs | 20 s later: `node /usr/bin/pan serve --port 3011 --no-open` (3080, 5 min 7 s old), `dashboard/server.js` (3091) and its deacon still running; `/api/health` → `{"status":"ok", … "pid":3091 …}`. |

## Cleanup

`fly machine destroy 811d32dbd41258 --force` → destroyed; `fly machines list -a pan-workspaces` → "No machines are available". Both `fly proxy` processes stopped (ports 10022 and 10023 free). `ssh-keygen -R '[127.0.0.1]:10022'` (0 entries left), `~/.ssh/id_ed25519{,.pub}` and the throwaway key directory removed. Side effect: `ssh-keygen -R` rewrites `~/.ssh/known_hosts.old`, and that backup file was then deleted, so an earlier `known_hosts.old` (if the operator had one) is gone; `known_hosts` itself lost only the entries this run added.

Status: failed — https://github.com/eltmon/overdeck/issues/4861 (case 2 passed)
