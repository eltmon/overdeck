# PAN-4774 — AC-10: npx connect on a fresh "VPS" survives logout and restart

- **Commit tested:** `npm pack --ignore-scripts` of `feature/pan-4774` (`overdeck-core-0.72.0.tgz`, integrated main plus this issue's changes).
- **Date:** 2026-11-02, 23:05–23:22 UTC. Fly machine `e826329b129ed8` (`pan4774-vps`, `shared-cpu-1x`, 2 GB, `iad`, image `registry.fly.io/pan-workspaces:pan-4774`), no volume.

## Checkpoint (WI-16): Fly's init must stay PID 1 → D-7 fallback

```
$ fly ssh console -a pan-workspaces --machine e826329b129ed8 -C 'cat /proc/1/comm; cat /proc/1/cmdline'
init
/fly/init
$ ls /sbin/init; command -v systemctl
ls: cannot access '/sbin/init': No such file or directory
no-systemctl
```

A Fly machine boots Fly's own init as PID 1, so systemd cannot run as PID 1 and no systemd user manager or lingering exists. As WI-16 directs, the D-7 systemd image was not built; the run records how far `connect` gets and files [#4863](https://github.com/eltmon/overdeck/issues/4863) "Run AC-10 on a real VPS". The D-7 Dockerfile, written from the decision and never built (Fly cannot run it), is kept for the real-VPS run:

```dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y systemd systemd-sysv openssh-server curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs \
 && useradd -m -s /bin/bash vps && mkdir -p /var/lib/systemd \
 && ln -s /home/.linger /var/lib/systemd/linger
CMD ["/sbin/init"]
```

`Linger=yes` and the `fly machine restart` step were not reached (no systemd).

## How far `connect` got

User `vps` created on the VM; the tarball uploaded with `fly sftp put` to `/home/vps/`.

**Run 1** — `su - vps -c 'npx --yes ./overdeck-core-0.72.0.tgz connect'`:

```
v22.23.4
error: unknown command 'connect'
(Did you mean context?)
connect exit=1
```

Cause: from the npx cache, `connect` first installs `@overdeck/core@0.72.0` from the npm registry into `~/.overdeck/runtime` and re-runs from there (`ensureDurableRuntime`, `src/cli/commands/connect.ts`). The published 0.72.0 predates `pan connect`, so a tarball of unreleased code with the same version cannot pass this step. `npx … connect --help` and `pan connect --help` from the tarball itself both work. This resolves with the first release that ships `connect`; it is recorded in #4863.

**Run 2** — the same with `OVERDECK_CONNECT_REEXEC=1`, so `connect` runs from the npx cache without the reinstall:

```
[dashboard] could not inspect port 3010; lsof, fuser, and ss all failed to execute
[dashboard] could not inspect port 3011; lsof, fuser, and ss all failed to execute
[dashboard] WARNING (PAN-2804): could not start the dashboard via systemd-run. …
Overdeck server: plain process.
No systemd user manager is available here (XDG_RUNTIME_DIR is not set — log in over SSH as vps directly), so the server runs as a plain process: it stops when you log out and does not start after a reboot.

Link this machine from another machine within 10 minutes, before this machine restarts:

  pan machines link 'http://<redacted>

Expires: 2026-11-02T23:31:37.377Z (single use)
The other machine must reach 172.19.10.186:3011. If a firewall blocks it, open that port or set up Tailscale with `pan tailscale setup`, then run pan connect again.
connect exit=0
```

The server (`dashboard/server.js`, pid 985) and supervisor (pid 1070) ran as `vps`. `loginctl` does not exist on the image. The link names the VM's private Fly address, which home cannot reach, so it was not used.

## Not shown

- A systemd user service with `Linger=yes`.
- Home linking the VPS and showing it `online`.
- The server surviving an SSH logout, and the VPS back `online` at home within 120 s after `fly machine restart` (a plain process on a Fly rootfs that resets on start cannot).

The `connect` fallback itself behaved as documented: it named the missing systemd user manager and warned that the server stops at logout and does not start after a reboot.

## Cleanup

`fly machine destroy e826329b129ed8 --force` → destroyed; `fly machines list -a pan-workspaces` → "No machines are available"; `fly volumes list -a pan-workspaces` → none. No directory registration was made (no sign-in on this VM).

Status: approximated — Fly cannot run systemd as PID 1; the real-VPS run is #4863 (https://github.com/eltmon/overdeck/issues/4863)
