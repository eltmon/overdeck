# PAN-4882 — AC-15 W-CONV9: Open in editor on an SSH-host machine

- **Commit tested:** home deployed build `b1d9d9dc554` (`pan` 0.73.0); fix under test PAN-4859 `054aea3e486`
  (the authority comes from the SSH destination, not from the local forward). The SSH VM runs published 0.73.0
  (`7de98491242`).
- **Date:** 2026-11-03, 06:43–06:46 UTC.
- **Machine:** the SSH VM `pan4882-ssh` (`811d674f124718`), added from the browser as
  `ssh://root@127.0.0.1:10022` with `launch: managed` ([ac-06-ssh-host.md](ac-06-ssh-host.md)); link
  `4155fbb0-246b-42f7-9a51-85512ed0675a`, environment `64fbc7ca-55aa-4a41-b0b0-29d2d8722907`, current route
  `tcp://127.0.0.1:45239` (the local forward).
- **Browser:** Playwright 1.63 Chromium (headless), own `userDataDir` `.tmp/pan-4882/pw-ac15`, signed in with
  the `#overdeck_token=<redacted>` link.
- **Editor precondition (D-11):** `command -v code codium code-insiders` on this host prints nothing (exit 1),
  so the route's `spawn` fails quietly and no editor window opens. Nothing was put on home's `PATH`.

## Conversation on the SSH VM

```
$ ssh -p 10022 root@127.0.0.1 'mkdir -p /root/ac15 && git -C /root/ac15 init -q'
$ ssh -p 10022 root@127.0.0.1 'pan project add /root/ac15 --name ac15'          # login shell
    ac15: { name: ac15, path: /root/ac15, issue_prefix: AC }
$ ssh -p 10022 root@127.0.0.1 'curl -s -X POST -H "Origin: http://localhost:3011" -H "content-type: application/json" \
    -H "x-overdeck-internal-token: <redacted>" localhost:3011/api/conversations \
    -d "{\"message\":\"ac15 hello\",\"harness\":\"claude-code\",\"cwd\":\"/root/ac15\",\"projectKey\":\"ac15\"}"'
{"id":1,"name":"20261103-2277","status":"active","cwd":"/root/ac15","harness":"claude-code","projectKey":"ac15",
 "environmentId":"64fbc7ca-55aa-4a41-b0b0-29d2d8722907",…}
```

**Deviations from WI-11.** The plain body `{"message","harness","cwd"}` was refused twice: first
`{"error":"Missing origin"}` (the mutation guard wants an `Origin` header with the internal token), then
`{"error":"cwd requires projectKey"}`. So `/root/ac15` was registered as project `ac15` on the VM and the body
carried `projectKey`. Neither changes what is checked: the shared row's `cwd` is still `/root/ac15`. The URL
`/conv/@811d674f124718/20261103-2277` (machine label) opened an empty deck; the conversation opened at
`/conv/@64fbc7ca-55aa-4a41-b0b0-29d2d8722907/20261103-2277` (environment id). The fake harness answered
(`fake-reply:ac15 hello` shows on home in the screenshot).

## Open in editor

On home's `/conv/@64fbc7ca-55aa-4a41-b0b0-29d2d8722907/20261103-2277`: **Open in editor**
(`aria-label="Open in editor over remote SSH"`) → **VS Code**. The network response of the route:

```
POST /api/linked-conversations/open-in-editor
request:  {"conversation":"@64fbc7ca-55aa-4a41-b0b0-29d2d8722907/20261103-2277","editor":"vscode"}
response: 200 {"ok":true,"commandLine":"code --remote ssh-remote+7b22686f73744e616d65223a223132372e302e302e31222c2275736572223a22726f6f74222c22706f7274223a31303032327d /root/ac15"}
picker shows: code --remote ssh-remote+7b22686f73744e616d65223a223132372e302e302e31222c2275736572223a22726f6f74222c22706f7274223a31303032327d /root/ac15
```

Decoding the authority:

```
$ node -e "console.log(Buffer.from(process.argv[1],'hex').toString())" 7b22686f73744e616d65223a223132372e302e302e31222c2275736572223a22726f6f74222c22706f7274223a31303032327d
{"hostName":"127.0.0.1","user":"root","port":10022}
```

Pass conditions:

| Condition | Result |
| --- | --- |
| Decoded JSON has `"hostName":"127.0.0.1"`, `"user":"root"`, `"port":10022` | yes |
| `commandLine` ends with ` /root/ac15` | yes |
| `commandLine` does not contain `ssh-remote+127.0.0.1 ` (the PAN-4774 failure) | yes (0 matches) |
| `commandLine` does not contain the forward's local port `45239` | yes (0 matches) |

Screenshot: [ac-15-open-in-editor.png](ac-15-open-in-editor.png) shows the linked conversation on home
(`on 811d674f124718`, `fake-reply:ac15 hello`) and the open picker. In the headless screenshot the picker's
menu is drawn over the header with its editor rows hard to read, and only the tail of the command line is
visible; the command line above is taken from the route's response and the picker's own text, not the image.

Status: passed — commandLine authority decodes to root@127.0.0.1 port 10022 and ends with /root/ac15
