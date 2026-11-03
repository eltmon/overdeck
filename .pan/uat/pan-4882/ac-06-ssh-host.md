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
