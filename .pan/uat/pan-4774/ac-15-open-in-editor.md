# PAN-4774 — AC-15 W-CONV9: Open in editor for a linked conversation

- **Commit tested:** `566db45dc87` (`feature/pan-4774`, built tree).
- **Date:** 2026-11-02, host `eltmon-z790`.
- **Pair:** `node scripts/anywhere/two-machine-smoke.mjs --hold` →
  `HOLD a=http://127.0.0.1:3041 b=http://127.0.0.1:3042 dev=36803 conversation=@0c30188a-cb9b-4bd6-bf1e-756283903f69/smoke-desk`.
- **Browser:** Playwright 1.63 Chromium (headless), own `userDataDir` at `.tmp/pan-4774/pw-ac15`, signed in to A with the `#overdeck_token=` link (a linked dashboard requires it; see [ac-13-open-preview.md](ac-13-open-preview.md)).
- **Fake editor:** `.tmp/anywhere-a/npm/bin/code` (first on A's `PATH`) appends its argv to `.tmp/anywhere-a/code-argv.log`.

## Run

On A's `/conv/@<B env>/smoke-desk`: **Open in editor** (`aria-label="Open in editor over remote SSH"`) → **VS Code**.

```
route answers: ["409 {\"error\":\"eltmon-z790 has no SSH host (no tailnet or ssh route)\",\"code\":\"no-ssh-host\"}"]
command line shown: code --remote ssh-remote+<machine> <its checkout>
toasts: ["Could not open in VS Code: eltmon-z790 has no SSH host (no tailnet or ssh route)"]
code argv log: (no log: code was not launched)
```

Screenshot: [ac-15-open-in-editor.png](ac-15-open-in-editor.png).

## Findings

1. **No `--remote ssh-remote+<host>` line can be produced on this host.** `POST /api/linked-conversations/open-in-editor` takes the SSH host only from a link route of kind `ssh` or `tailnet` (`sshHostFor`, `src/dashboard/server/services/open-remote.ts`). The smoke pair links over `pairing` and `lan` routes, and Tailscale is not installed here, so the route answers `409 no-ssh-host` and the UI shows the toast above. That refusal is the documented behavior for a LAN-only link, and it works as designed. The PRD's pass condition (an argv line naming B's checkout) assumed a route this host does not have.
2. **Defect: an SSH-host machine opens `ssh-remote+127.0.0.1`.** A machine added as an SSH host links over the local port forward (`tcp://127.0.0.1:<localPort>`, `kind: 'ssh'`, `ssh-machine-service.ts` line 301), so `sshHostFor` returns `127.0.0.1`:
   ```
   resolveRemoteEditorLaunch({ editor: 'vscode', link: { routes: [{ kind: 'ssh', url: 'tcp://127.0.0.1:40123' }] }, cwd: '/home/root/project' })
   → {"command":"code","args":["--remote","ssh-remote+127.0.0.1","/home/root/project"]}
   ```
   VS Code would open the local machine's own SSH server, not the SSH host. Not fixed here (D-4): the fix needs the SSH record's destination mapped to a VS Code Remote-SSH authority with user and port, a format this run cannot verify. Filed as [#4859](https://github.com/eltmon/overdeck/issues/4859).
3. The tailnet path (a `wss://<name>/ws/link` route) is covered only by the existing unit tests of `open-remote`; it needs Tailscale on both machines (AC-3 Tailscale is run by the operator).

Status: failed — https://github.com/eltmon/overdeck/issues/4859
