# PAN-4882 — cleanup audit

Run 2026-11-03 at 07:39 UTC, after every VM item finished. Nothing from the run remains.

```
$ fly machines list -a pan-workspaces
No machines are available on this app pan-workspaces
$ fly volumes list -a pan-workspaces
 ID │ STATE │ NAME │ SIZE │ REGION │ ZONE │ ENCRYPTED │ ATTACHED VM │ CREATED AT 

$ pan machines list
This machine: eltmon-z790 (da4f-8c0c-2c16-a4de-a128)

LABEL                       STATE  ROUTE  ACCESS  SSH  FINGERPRINT               LOAD                        TAGS
eltmon-z790 (this machine)  self   -      -       -    da4f-8c0c-2c16-a4de-a128  CPU 10% · 14 GB · 8 agents  docker, gpu, linux

No linked machines. Link one with `pan machines link <pairing-url>` using a `pan pair` link from the other machine.

Inbound: no machine links to this one.
$ pan machines directory --json | jq '[.machines[].label]'
["eltmon-z790"]
$ grep -n -A1 '^\[remote\]' ~/.overdeck/config.toml
26:[remote]
27-enabled = false
$ grep -c pan4882 ~/.overdeck/projects.yaml
0
$ test -e ~/.ssh/id_ed25519 || echo absent
absent
$ ss -ltnp | grep -c ':10022 '
0
$ pgrep -af 'fly proxy' | grep -v pgrep | grep -c 'proxy 10022'
0
$ ls -d /home/eltmon/Projects/pan4882-*
ls: cannot access '/home/eltmon/Projects/pan4882-*': No such file or directory
$ pan account status
Signed in as eltmon (GitHub id 678719)
Access:          active
```

Home-side records the run leaves as history, not as live state:

- Root conversation `20261103-6766` (id 3531): `status: ended`, `endedAt: 2026-11-03T06:57:08.096Z`. The three lane
  conversations were archived by `pan lane reap`.
- The remote worker's stand-in `~/.overdeck/agents/agent-pananywher-1-worker-1/` stays as the agent's write-once
  registration; `pan worker list` shows it `stopped`, `#1 done`. Its `remote.json` still reads `state: running`
  with `unreachableSince: 2026-11-03T06:57:17.819Z`, because its VM was destroyed while the worker's session was
  still open.
- The SSH VM's linked conversation `@64fbc7ca-…/20261103-2277` lived on that VM and went with it.
- `~/.ssh/known_hosts.old` was rewritten by `ssh-keygen -R` (see `ac-06-ssh-host.md`, "Cleanup").
- The Flywheel was told at 07:36 UTC that the VMs are torn down and the reload hold is lifted.

No leftover needed removal, so the commands were not re-run.
