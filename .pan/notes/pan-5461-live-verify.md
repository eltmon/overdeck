# PAN-5461 live verification (WI-8)

Run 2026-11-17 on `eltmon-z790` (X11 GNOME, `DISPLAY=:1`) against the workspace build
(`npm run build`, exit 0). Throwaway dashboard:
`OVERDECK_HOME=/home/eltmon/.overdeck/tmp/pan-5461-verify PORT=3471 node dist/dashboard/server.js`
(Node v22.22.0), called at `http://127.0.0.1:3471` with the throwaway home's internal token. The
operator's `~/.overdeck/config.yaml` was never read or written.

## Step 1: GET /api/computer-use/status

`platform: linux`, `supported: true`, `enabled: false`, `hostname: eltmon-z790`, `lease: null`,
`skill: { installed: true, locations: [~/.claude/skills, ~/.agents/skills] }`,
`session: { ok: true, label: "x11 · display :1" }`. Every check `ok`:

| id | detail |
| --- | --- |
| session | x11 · display :1 |
| atspi | Importable |
| gnome-a11y | On |
| input | xdotool |
| screenshots | Built in on X11 |
| clipboard | xclip |
| helper | Handshake ok |

`setupSteps`: `[enable-flag "Turn on Computer Use", test-helper "Test the helper"]`. Matches the
expected result.

## Step 2: POST /api/computer-use/setup

`ok: true`; steps `enable-flag: done`, `test-helper: done`. The returned status has
`enabled: true` and `setupSteps: []`. The throwaway `config.yaml` then contained:

```yaml
computer_use:
  enabled: true
```

## Step 3: pkexec checkpoint (D-17)

A Bun script imported `installPackages` from `src/lib/computer-use/setup-linux.ts` and
`resolveDesktopEnv` from `src/lib/computer-use/desktop-env.ts`, then called
`installPackages('apt-get', ['xdotool'], { label: 'x11', env }, { spawnDetached: () => {} })`.
Output: `ELAPSED_MS 10002`, `RESULT "PENDING"`.

Outcome under the 10-second rule: **still pending after 10 s, so a polkit dialog was up: the
pkexec path works** on this desktop (GNOME Shell's polkit agent). No `pkexec` process remained
after the script exited (`pgrep -af pkexec` found none), so nothing needed killing. No package was
installed or removed.

## Step 4: screenshots (isolated headless Chromium, inspected)

1. **Off** (before step 2): title "Computer Use is off" with a neutral `Off` badge; description
   "Everything it needs is already installed. One click turns it on."; blue primary button "Turn on
   Computer Use" with "No password needed." beside it; lede names `eltmon-z790`. The expanded
   "What Overdeck checked" list shows all seven checks with muted details and
   "pan-computer-use skill — installed in ~/.claude/skills, ~/.agents/skills".
2. **On / Free** (after step 2): title "Computer Use is on" with an emerald `Ready` badge; the
   no-quit/lock/log-out description; "Allow agents to use the desktop" switch on with "Turning this
   off stops new actions right away."; "Desktop control" with a neutral `Free` badge and a disabled
   "Take back control" button; same checks list.
3. **On / In use** (fake `computer-use/lease.json`, holder `agent-pan-9999`, expiring 110 s ahead):
   same as On / Free except "Desktop control" shows a blue `In use` badge, the line
   "agent-pan-9999 is driving the desktop · its turn ends in 108s unless it acts again.", and an
   enabled "Take back control" button.

The Unavailable state is covered by `ComputerUseSection.test.tsx` only.

## Step 5: cleanup

Stopped the throwaway server (pid confirmed by its `OVERDECK_HOME=/home/eltmon/.overdeck/tmp/pan-5461-verify`
and `PORT=3471` environment), then `rm -rf /home/eltmon/.overdeck/tmp/pan-5461-verify`.
`test -e /home/eltmon/.overdeck/tmp/pan-5461-verify` now fails. PNGs were not committed.
