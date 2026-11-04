---
type: reference
description: Live Fly checks from a peer test dashboard need a branch-built VM
  image, a separate HOME and a symlinked server path
updated: 2026-11-02
---

A live Fly check run from a peer test dashboard (own OVERDECK_HOME, port 3941) needs three things, learned on PAN-4734 (2026-11-02): (1) a test image registry.fly.io/pan-workspaces:<tag> with the branch's packed @overdeck/core, set as [remote.fly] image, because provisioning pins the VM's pan to home's version and the published package lacks branch code; run fly auth docker right before docker push and verify the digest, a hidden NAME_UNKNOWN push failure wasted a run; (2) a separate HOME with symlinks to the real ~/.claude, ~/.config, ~/.fly, ~/.gitconfig and ~/.overdeck/skills, because remote-state lives under homedir()/.overdeck/agents and the host deacon would reap it; (3) start the peer server through a symlink whose path does not contain dist/dashboard/server.js, or the host orphan reaper kills it after 120 s. **Why:** each of these cost a failed live run. **How to apply:** set all three up before the first pan start --remote; the full record is in docs/fly-provider.md, Live verification (PAN-4734).
