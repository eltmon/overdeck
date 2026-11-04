# Overdeck Anywhere release checklist (AC-1 to AC-15)

How to run the Overdeck Anywhere release acceptance criteria (`.pan/drafts/pan-2350.md`,
"Acceptance criteria") on integrated main, and what the first full run found (PAN-4774,
2026-11-02, branch `feature/pan-4774` on top of main `194adf91f96`). Each section gives the
commands, the expected output, the cleanup and that run's status. The evidence files are in
`.pan/uat/pan-4774/` on that branch.

## Prerequisites

- A built tree: `npm run build` (the smokes and the AC-1 test run `dist/`).
- `tmux` (the AC-1 test and the smokes use tmux-backed peer dashboards), Docker for AC-9's
  docker half.
- `flyctl` logged in (`fly auth whoami`), app `pan-workspaces` with a shared IPv4 and an IPv6
  (`docs/fly-provider.md`, "Public IPs").
- A signed-in overdeck.ai account on home (`pan account status` → `Access: active`), plan
  `tester` for the relay and the inbox (`pan machines directory --json` shows `plan`).
- New machines sign in with the device flow: run `pan account login` on them and send the code
  with `pan tell conv-flywheel "PAN-<n> device code <CODE> <URL>"` (run `pan tell` outside the
  Bash sandbox); the Flywheel approves it in the browser. Never copy `account.json`.
- A linked dashboard turns `require_token_mint` on (`autoReasons: machine-link`), so a browser
  signs in only through `<base>/<path>#overdeck_token=<OVERDECK_HOME>/internal-token`.
- Peer test dashboards: own `OVERDECK_HOME` **with a short path** (the PTY socket
  `${OVERDECK_HOME}/sockets/pty-conv-<name>.sock` must stay under about 107 bytes, so use a
  `/tmp/odk-*` symlink), started through a symlink to `dist/dashboard/server.js` (the host orphan
  reaper kills a `dist/dashboard/server.js` command line after 120 s), with
  `OVERDECK_DISABLE_DEACON=1` and `OVERDECK_ANYWHERE_SUPERVISOR=1` (without it the directory
  client stays `off`). Stop a peer by the pid that listens on its port, not by the `setsid` pid.
- A Fly VM or SSH host must run home's exact `pan` version. `add-fly` installs
  `@overdeck/core@<home version>` from npm, and a hand-made VM does the same with
  `npm install -g`, which works whenever home's version is published (npm `latest` may be newer).
  A branch image is needed only when home's version is not on npm: build it and pass it per
  call (AC-5 below); never change `[remote.fly] image` in home's config.

## AC-1 — two machines: link, list, remote control, pull, refuse

**Commands.**

```bash
VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/anywhere/two-machine-ac1.slow.test.ts
node scripts/anywhere/two-machine-smoke.mjs
node scripts/anywhere/two-machine-smoke.mjs --live-claude   # real Claude Code, small model cost
```

**Expected.** The test prints `7 passed` (links both ways, lists within 15 s, opens within
budget, remote-controls a fake-claude conversation, pulls it into A's own clone with an
uncommitted file, B and the old `@<B>` name answer 409 `conversation-released`, nothing in
plaintext). CI runs it in the `test-e2e` job. The smokes print `OK: …`.

**Cleanup.** The test removes its `/tmp/odk-*` homes, tmux servers and harness processes; the
smokes clean `.tmp/anywhere-a|b`.

**2026-11-02:** passed — 7/7 in about 57 s; smoke exit 0; `--live-claude` exit 0
(`local-smoke.md`, `live-claude-smoke.md`). On one host the `--live-claude` pull adopts into
B's checkout; the test uses `OVERDECK_TEST_ADOPT_SKIP_SAVED_CWD=1` on A to adopt into a
distinct clone.

## AC-2 — no plaintext on the link or the relay

**Commands.** Local half: the smoke's `no-http` step, and
`node scripts/anywhere/two-machine-smoke.mjs --inject-plain-http` (must exit 1 at `no-http`).
Relay half: in the AC-3 VM, `tcpdump -i any -w /tmp/relay.pcap` while the relay carries a
conversation, then `strings /tmp/relay.pcap | grep -c <marker>` and `grep -c HTTP/1.1` on
the relay packets only (`-i any` also captures loopback health checks).

**Expected.** First byte `0x00`, no `HTTP/1.1`; the relay capture has no marker and no HTTP.

**2026-11-02:** failed — local half passed; the relay never connected, so the relay half was
not shown ([#4862](https://github.com/eltmon/overdeck/issues/4862); `ac-03-direct-relay.md`).

**2026-11-03 re-run (PAN-4882, build b1d9d9dc554):** not-run — the relay VM never signed in: three
device codes expired unapproved over 57 min, so no relay channel opened to capture
([#4886](https://github.com/eltmon/overdeck/issues/4886); `.pan/uat/pan-4882/ac-02-03-relay.md`).

**2026-11-04 re-run (PAN-4886, build 65e3b1adf86):** not-run — the relay VM never signed in: two
device codes expired unapproved (10:52–11:23 UTC) because the approving browser was not connected
(`.pan/uat/pan-4638/check-2-pan-4886-relay.md`).

## AC-3 — Tailscale, direct, relay with UDP blocked

**Commands.**

```bash
fly machine run registry.fly.io/pan-workspaces:<branch-tag> -a pan-workspaces --region iad \
  --vm-memory 2048 --vm-cpus 1 --vm-cpu-kind shared --name <name> --detach
# on the VM: HOME=/root pan serve --port 3011 --no-open; pan account login (device flow)
pan machines join --to <home label> --json          # VM
pan machines approve <request-id> --yes             # home; both print the same code
pan machines accept <request-id>                    # VM
pan machines list --json                            # home: current route rtc://<env> (direct)
# UDP blocked inside the VM (iptables and ip6tables), DNS kept:
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT; iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p udp -j DROP; iptables -A INPUT -p udp -j DROP
# home: POST /api/machines/<link id>/reconnect, then expect currentRoute rtc+turn://… and
# "Using relay" on the status card, with relay bytesUsed rising in pan machines directory --json
```

Tailscale: the operator runs **Set up Tailscale** on home (it installs system software and
signs into the operator's tailnet), then links a machine over the tailnet.

**Cleanup.** VM `pan account logout`; home `pan machines unlink <label>` and
`pan machines forget <label>`; `pan machines directory --json` lists only home; destroy the VM.

**2026-11-02:** failed — direct passed (`online rtc://…`, Tailscale on neither). With UDP
blocked the relay never connected: werift keeps only the first TURN URL (UDP) and ignores the
TCP/TLS ones ([#4862](https://github.com/eltmon/overdeck/issues/4862)). Tailscale not run:
blocked on an operator decision (`ac-03-tailscale.md`).

**2026-11-03 re-run (PAN-4882, build b1d9d9dc554):** not-run — UDP blocked and TCP 443 only both
need the relay VM signed in, and three device codes expired unapproved over 57 min
([#4886](https://github.com/eltmon/overdeck/issues/4886); `.pan/uat/pan-4882/ac-02-03-relay.md`).

**2026-11-04 re-run (PAN-4886, build 65e3b1adf86):** not-run — UDP blocked and TCP 443 only both
need the relay VM signed in, and two device codes expired unapproved
(`.pan/uat/pan-4638/check-2-pan-4886-relay.md`).

## AC-4 — remote worker and a three-machine gauntlet

**Commands.** Two VMs: `pan machines add-fly --project <throwaway> --image <branch image> --json`.
Prepare the issue workspace on the VM (`git worktree add workspaces/feature-<issue> -b
feature/<issue>`), then on home:

```bash
pan worker run --machine <fly1> --issue <ISSUE> --read-only --parent conv-<root> \
  --harness claude-code --model claude-sonnet-5-5 --ignore-unpushed --detach --prompt "<brief that reports>"
pan worker wait <local id> --timeout 600
pan lane start --role play --run <run> --key <home|fly1|fly2> --parent <root conv> --project <p> \
  --harness claude-code --model claude-sonnet-5-5 [--machine <fly>] --no-wait --json --prompt "<write report.md, pan lane report --status done>"
pan lane wait <name> --timeout 600; pan lane list --run <run> --json
pan lane stop <name>; pan lane reap <name>
```

The throwaway project's issue prefix must be letters only
([#4860](https://github.com/eltmon/overdeck/issues/4860)).

**Cleanup.** `pan machines unlink` both VMs (destroys them), stop the root conversation,
`pan project remove <p>`, delete the clone and its `-lanes` directory.

**2026-11-02:** failed — the gauntlet passed on home and two Fly VMs; the remote worker
reported on the VM but home's stand-in was marked `exited` 0.3 s after start. Fixed in
`4f2c07a2e9d` (the follower keeps a startup grace); re-check after deploy
(`ac-04-fly-worker-lanes.md`).

**2026-11-03 re-run (PAN-4882, build b1d9d9dc554):** passed — `pan worker wait` returned the fly1
worker's report with the stand-in still following, and three lanes (home, fly1, fly2) reported;
two of three worker starts first missed the 2.5 s secure-channel budget
([#4885](https://github.com/eltmon/overdeck/issues/4885); `.pan/uat/pan-4882/ac-04-fly-worker-lanes.md`).

## AC-5 — a conversation on a Fly VM, streamed home, pulled home

**Commands.** `remote.enabled = true` in `~/.overdeck/config.toml` `[remote]` for the run
(restore `false` after). Branch image:

```bash
npm pack --ignore-scripts --pack-destination .tmp/pan-4774/image
# Dockerfile: FROM registry.fly.io/pan-workspaces:latest
#             COPY overdeck-core-<v>.tgz /tmp/  then  RUN npm install -g /tmp/overdeck-core-<v>.tgz
fly auth docker; docker build -t registry.fly.io/pan-workspaces:<tag> .; docker push …
pan machines add-fly --project <throwaway> --image registry.fly.io/pan-workspaces:<tag> \
  --model claude-sonnet-5-5 --message "Answer with one short line: hello from Fly." --json
fly ssh console -a pan-workspaces --machine <id> -C "sh -c 'echo x > <checkout>/uncommitted.txt'"
pan conv pull @<env>/<conv> --stop-turn --json
pan machines unlink <label>
```

The throwaway project is the operator's smallest public repository that no registered project
names, cloned beside the other projects; never a primary checkout.

**Expected.** Link `online`, the reply in home's `/messages`, pull `state: done` into the
throwaway clone with `uncommitted.txt`, 409 `conversation-released` from the VM's copy, unlink
destroys the VM.

**2026-11-02:** passed (`ac-05-fly-conversation.md`).

## AC-6 — an SSH host from a browser

**Commands.** A Fly VM from the branch image with `openssh-server` started as
`/usr/sbin/sshd -p 2222` (port 22 on a Fly VM's private address is Fly's own SSH), reached with
`fly proxy 10022:2222 <id>.vm.pan-workspaces.internal -a pan-workspaces`. Home's SSH runs with
`BatchMode=yes`; if its agent cannot take a key without a prompt, place a throwaway key as the
default identity for the run and add the VM's host key for `[127.0.0.1]:10022`. In an isolated
browser: Settings → Anywhere → **Add an SSH machine** → `ssh://root@127.0.0.1:10022`, then
**Remove**. Case two: start `pan serve --port 3011 --no-open` on the VM yourself, add, remove.

**Expected.** Case one: `launch: managed`, removal stops the server. Case two:
`launch: external` ("Already running"), removal leaves it running.

**Cleanup.** Destroy the VM, stop `fly proxy`, `ssh-keygen -R '[127.0.0.1]:10022'`, remove the
throwaway identity.

**2026-11-02:** failed — case two passed; in case one the `pan up` supervisor restarted the
dashboard after the helper stopped it ([#4861](https://github.com/eltmon/overdeck/issues/4861);
`ac-06-ssh-host.md`).

**2026-11-03 re-run (PAN-4882, build b1d9d9dc554):** passed — case one: after **Remove** the
VM ran no dashboard or supervisor and `/api/health` answered `000` at 30, 90 and 180 s
(`.pan/uat/pan-4882/ac-06-ssh-host.md`). Case two was not re-run.

## AC-7 — push within 10 s, unreadable at the push service

**Playwright outline (D-10).** Peer test dashboard; `chromium.launchPersistentContext(<own
userDataDir>, { channel: 'chrome', headless: false, env: { DISPLAY: ':1' }, permissions:
['notifications'] })`; Settings → Anywhere → Phone notifications → **Turn on notifications**;
wait until `GET /api/push/status` lists a `thisDevice` subscription; click **Send test**; poll
`registration.getNotifications()` inside one `page.evaluate` loop (an async predicate passed to
`waitForFunction` resolves at once) for the title `Overdeck test notification`.

Unreadable half: the store accepts only known push services over https, so run
`createWebPushProvider` with a generated P-256 subscription and a stubbed `fetchImpl`, assert
`Content-Encoding: aes128gcm`, the title absent from the body, and that `http_ece` decrypts it
only with the subscriber's private key.

**Cleanup.** `DELETE /api/push/subscriptions/<id>` with `Content-Type: application/json`,
stop the peer, delete the profile.

**2026-11-02:** approximated — desktop Chrome, no phone; 615, 1,093 and 1,806 ms
(`ac-07-push.md`).

## AC-8 — W-DOC

**Commands.** Check each W-DOC page exists with its topics, the `docs.json` entries, the
CLAUDE.md row, the supersede headers, and every "planned" label in `anywhere.mdx` against its
issue's state; `npm run lint:docs`.

**2026-11-02:** passed after two fixes (`pan tell @<label>/<conv>` in `cli/machines.mdx`;
PAN-4734 no longer "planned") (`ac-08-wdoc.md`).

## AC-9 — Auto avoids a saturated machine; `--needs docker`

**Commands.** `node scripts/anywhere/two-machine-smoke.mjs` steps `auto` (B restarted with
`OVERDECK_TEST_FORCE_CPU_SATURATED=1`) and `needs-docker` (B's fake `docker` exits 1).

**2026-11-02:** passed (`local-smoke.md`).

## AC-10 — `npx @overdeck/core connect` on a fresh VPS

**Dockerfile (D-7, written from the decision and not yet built: a Fly machine cannot run it, see below).**

```dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y systemd systemd-sysv openssh-server curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs \
 && useradd -m -s /bin/bash vps && mkdir -p /var/lib/systemd \
 && ln -s /home/.linger /var/lib/systemd/linger
CMD ["/sbin/init"]
```

**Commands.** On a real VPS with systemd, as the normal user over SSH:
`npx @overdeck/core@<release> connect`; check "Overdeck server: systemd user service" and
`loginctl show-user <user> -p Linger`; link from home with the printed link; log out; reboot;
home shows it `online` within 120 s.

**2026-11-02:** approximated — a Fly machine's PID 1 is `/fly/init`, so `connect` fell back to
a plain process; a locally packed tarball also reinstalls the published same-version package,
which has no `connect`. Run on a real VPS after a release:
[#4863](https://github.com/eltmon/overdeck/issues/4863) (`ac-10-vps-connect.md`).

## AC-11 — webhook inbox while the target is offline

**Commands.** On a signed-in peer:
`pan triggers add <name> --project <p> --prompt "<…>" --verify github --inbox --json`; stop the
peer; POST a `ping` with `X-Hub-Signature-256: sha256=<HMAC-SHA256(body, generated secret)>` to
`inboxUrl` (expect `202 {"queued":true}`); wait 30 s; start the peer; the trigger's conversation
starts within 60 s. Storage half: `node scripts/anywhere/directory-smoke.mjs`, step `inbox`.

**Cleanup.** Stop the conversations, `pan triggers remove <id>`,
`pan machines forget <peer env>` on home, `pan account logout` on the peer, stop it.

**2026-11-02:** passed (`ac-11-webhook-inbox.md`).

## AC-12 — MCP client through Copy MCP URL

**Commands.** The smoke's `mcp` step (`pan token create … --json`, `list_machines`,
`list_conversations`, `send_message`, `PUT /api/settings` → 403). To cover the button itself,
mint the token with **Copy MCP URL** in a browser (`POST /api/access-tokens`) and run the same
tools.

**2026-11-02:** approximated — the smoke passed, but its token came from `pan token create`,
which calls the same `createAccessToken({ kind: 'token' })` as the button; the button and its
route were not exercised (`local-smoke.md`).

## AC-13 — Open preview; the dashboard port refused

**Commands.** `node scripts/anywhere/two-machine-smoke.mjs --hold`; in an isolated browser on A,
`/conv/@<B env>/smoke-desk` → **Preview** → **Other port** = the HOLD line's `dev` → **Open
preview**; the new tab shows `hello from b`. CLI half: the smoke's `forward` step.

**2026-11-02:** passed (`ac-13-open-preview.md`, `local-smoke.md`).

## AC-14 — the open budget

**Commands.** The AC-1 test's `opens within the NFR-9 budget` and the smoke's `open-budget`
(bytes from B counted at the proxy, an upper bound on the channel counters, D-3).

**2026-11-02:** passed — 618,957 of 1,114,112 bytes for a 5,053,880-byte transcript.

## AC-15 — W-CONV7, W-CONV9, W-WORK7, W-WORK8, W-LINK7 (harness half)

**Commands.** Smoke steps `tell-once` (W-CONV7), `usage` (W-WORK7), `compare` (W-WORK8),
`versions` + `update-all` (W-LINK7). W-CONV9: **Open in editor** on a linked conversation
needs a `tailnet` or `ssh` route; with only `pairing`/`lan` routes it answers `409 no-ssh-host`.

**2026-11-02:** failed — the smoke steps passed; W-CONV9 could not produce an
`ssh-remote+<host>` launch here, and an SSH-host machine targets `ssh-remote+127.0.0.1`
([#4859](https://github.com/eltmon/overdeck/issues/4859); `ac-15-open-in-editor.md`).

**2026-11-03 re-run (PAN-4882, build b1d9d9dc554):** passed — W-CONV9 on an SSH-host machine
returned `code --remote ssh-remote+<hex> /root/ac15`, whose authority decodes to
`{"hostName":"127.0.0.1","user":"root","port":10022}` (`.pan/uat/pan-4882/ac-15-open-in-editor.md`).
