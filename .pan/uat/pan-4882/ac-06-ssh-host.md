# PAN-4882 — AC-6 managed SSH host: add from the browser, remove, server and supervisor stay stopped

- **Commit tested:** home deployed build `b1d9d9dc554` (`pan` 0.73.0); fix under test PAN-4861 `af764fb9907`.
- **Date:** 2026-11-03. Fly app `pan-workspaces`, region `iad`.
- **SSH VM:** `pan4882-ssh`, machine `811d674f124718`, `shared-cpu-1x:2048MB`, image
  `registry.fly.io/pan-workspaces:latest` plus `npm install -g @overdeck/core@0.73.0` (install path from
  `preflight.md`).

## Setup

```
$ fly machine run registry.fly.io/pan-workspaces:latest -a pan-workspaces --region iad --vm-memory 2048 \
    --vm-cpus 1 --vm-cpu-kind shared --name pan4882-ssh --detach
 Machine ID: 811d674f124718
Machine started, you can connect via the following private ip

# on the VM (fly ssh console):
#   apt-get install -y -qq openssh-server tmux            → apt-exit=0
#   npm install -g @overdeck/core@0.73.0                  → npm-exit=0
#   fake harness → /root/fakebin/{claude,fake-claude-writer.mjs} (tests/helpers/anywhere/fake-claude.ts,
#     input log path edited to /root/fake-claude-input.log)
#   echo 'export PATH=/root/fakebin:$PATH' >> /root/.profile
#   printf 'terminal:\n  backend: tmux\n' > /root/.overdeck/config.yaml       (D-18)
#   /root/.ssh/authorized_keys ← .tmp/pan-4882/ssh/id_ed25519.pub (throwaway key "pan4882-throwaway")
#   mkdir -p /run/sshd; /usr/sbin/sshd -p 2222
$ ps -eo pid,args | grep [s]shd
 1736 sshd: /usr/sbin/sshd -p 2222 [listener] 0 of 10-100 startups

# on home: preflight recorded "id_ed25519 absent", so the throwaway key became the default identity
$ ssh-keygen -q -t ed25519 -N '' -C pan4882-throwaway -f .tmp/pan-4882/ssh/id_ed25519
$ cp .tmp/pan-4882/ssh/id_ed25519 ~/.ssh/id_ed25519; cp .tmp/pan-4882/ssh/id_ed25519.pub ~/.ssh/id_ed25519.pub
$ nohup fly proxy 10022:2222 811d674f124718.vm.pan-workspaces.internal -a pan-workspaces > .tmp/pan-4882/proxy.log 2>&1 &
Proxying localhost:10022 to remote [811d674f124718.vm.pan-workspaces.internal]:2222
```

Reachability, using the same login-shell wrapper the SSH helper sends (`remoteCommand`,
`src/lib/anywhere/ssh/target.ts`):

```
$ ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p 10022 root@127.0.0.1 \
    "sh -c 'exec \"\${SHELL:-/bin/sh}\" -lc \"pan --version; command -v claude\"'"
0.73.0
/root/fakebin/claude
```

A plain non-login `ssh … 'command -v claude'` prints `/usr/bin/claude`: the workspace image carries a real Claude
Code. The managed server starts through the login shell, so it gets the fake harness from `/root/.profile`.

## Add (managed) — from the browser

Browser: Playwright 1.63 Chromium (headless), own `userDataDir` `.tmp/pan-4882/pw-ac06`, home
`http://127.0.0.1:3011/settings#overdeck_token=<redacted>` → **Anywhere** → Machines → **Add an SSH machine** →
host `ssh://root@127.0.0.1:10022` → **Add** (06:39:45–06:40:47 UTC). Another agent's operator question
(PAN-4852) opened as a modal over the page; the script clicked its **Minimize** button, which keeps the question
open in "Needs you" and answers nothing.

```
POST /api/machines/ssh 200 27.2s
{"id":"4155fbb0-246b-42f7-9a51-85512ed0675a","label":"811d674f124718","access":"operator","state":"connecting",
 "routes":[{"url":"tcp://127.0.0.1:45239","kind":"ssh",…},{"url":"tcp://172.19.12.186:3011","kind":"lan",…},
           {"url":"tcp://172.19.12.187:3011","kind":"lan",…}],
 "peerVersion":"0.73.0",
 "ssh":{"destination":"ssh://root@127.0.0.1:10022","launch":"managed","forward":"up","localPort":45239,"remotePort":3011}}

$ pan machines list --json | jq -c '.links[] | select(.label=="811d674f124718") | {label,state,access,currentRoute,ssh,peerVersion}'
{"label":"811d674f124718","state":"online","access":"operator","currentRoute":"tcp://127.0.0.1:45239",
 "ssh":{"destination":"ssh://root@127.0.0.1:10022","launch":"managed","forward":"up","forwardDetail":null,"localPort":45239,"remotePort":3011},
 "peerVersion":"0.73.0"}
```

The machine row (DOM text; the screenshot [ac-06-online.png](ac-06-online.png) truncates the second and third
lines with an ellipsis at every viewport width):

```
811d674f124718 · Online · via ssh · tcp://127.0.0.1:45239 · Operator-level · Overdeck 0.73.0 · heartbeat just now ·
CPU 2% · 1 GB · 0 agents · tags: linux · SSH ssh://root@127.0.0.1:10022 · forward up · Started by Overdeck ·
Routes (3) · Compare settings · Add a project · Remove
```

On the VM after the add:

```
$ ps -eo pid,etimes,args | grep -E 'supervisor/server.js|dashboard/server.js' | grep -v grep
 1966      79 /usr/bin/node /usr/lib/node_modules/@overdeck/core/dist/dashboard/server.js
 2187      71 /usr/bin/node /usr/lib/node_modules/@overdeck/core/dist/supervisor/server.js
$ curl -s 127.0.0.1:3011/api/health
{"status":"ok","repoRoot":"/usr/lib/node_modules/@overdeck/core","mode":"primary","pid":1966,
 "buildCommit":"7de984912426d60fef92d4d6024078d7c9257818","builtAt":"2026-11-03T03:19:58.364Z",…}
$ cat /root/.overdeck/ssh-launch/server.json
{"v":1,"pid":1966,"apiPort":3011,"version":"0.73.0","startedAt":"2026-11-03T06:40:29.287Z","startedBy":"<home env id>"}
```

The VM runs the published 0.73.0 build, `7de98491242` (tag `v0.73.0`). All four fix SHAs are ancestors of it
(`git merge-base --is-ancestor <sha> 7de98491242` → yes for `04f8bccc9df`, `6ca4ae19e6e`, `af764fb9907`,
`054aea3e486`), so the VM-side half of PAN-4861 (the helper's stop) is the fixed code.

## Remove — from the browser

Before removal the VM ran `dashboard/server.js` (pid 1966, 458 s) and `supervisor/server.js` (pid 2187, 450 s).
In the same isolated browser: the machine row's **Remove** →

```
dialog: Remove 811d674f124718? · This machine loses access to 811d674f124718, and 811d674f124718 is told to drop
its access here. · Overdeck started the server on ssh://root@127.0.0.1:10022. Removing this machine stops that
server. · Leave the server running · Cancel · Remove
leave-running checked: false
removed-at 2026-11-03T06:48:46.641Z
DELETE /api/machines/4155fbb0-246b-42f7-9a51-85512ed0675a 200 {"ok":true,"peerNotified":false,"ssh":{"stopped":true,"reason":"stopped"},"fly":null}
```

Screenshot: [ac-06-remove-dialog.png](ac-06-remove-dialog.png). Home's link list afterwards held only the two
AC-4 Fly VMs.

D-12 checks on the VM, each through `ssh -p 10022 root@127.0.0.1` running
`ps -eo pid,etimes,args | grep -E 'supervisor/server.js|dashboard/server.js' | grep -v grep` (exit 1 = no
match) and `curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:3011/api/health`:

| After Remove | Matching processes | `/api/health` | `/root/.overdeck/ssh-launch/` |
| --- | --- | --- | --- |
| 30 s (06:49:16) | none (`procs-exit=1`) | `000` | empty |
| 90 s (06:50:16) | none (`procs-exit=1`) | `000` | empty |
| 180 s (06:51:46) | none (`procs-exit=1`) | `000` | empty |

In PAN-4774 the supervisor stayed up and restarted the dashboard 26–30 s after removal. Here both stayed stopped
for three minutes, so the PAN-4861 fix holds live. `peerNotified: false` is expected: the helper stops the VM's
server, so it cannot answer the unlink notice.

## Cleanup

```
$ fly machine destroy 811d674f124718 -a pan-workspaces --force
811d674f124718 has been destroyed
$ kill 3175189            # the `fly proxy 10022:2222 …` pid listening on 127.0.0.1:10022
$ ss -ltnp | grep -c ':10022 '
0
$ ssh-keygen -R '[127.0.0.1]:10022'
/home/eltmon/.ssh/known_hosts updated.
Original contents retained as /home/eltmon/.ssh/known_hosts.old
$ rm -f /home/eltmon/.ssh/id_ed25519 /home/eltmon/.ssh/id_ed25519.pub
$ rm -rf /home/eltmon/Projects/overdeck/workspaces/feature-pan-4882/.tmp/pan-4882/ssh
$ test -e ~/.ssh/id_ed25519 || echo "id_ed25519 absent"
id_ed25519 absent
```

`ssh-keygen -R` rewrote `~/.ssh/known_hosts.old` as its backup. The run leaves that file in place rather than
deleting an operator file it cannot tell apart from an earlier one; `~/.ssh/config` was not touched.

Status: passed — managed server and supervisor stayed stopped at 30/90/180 s after browser Remove
