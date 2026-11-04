# PAN-4728 — WI-7 live checkpoint

Live verification of the pstack skill pack against this host, through the
workspace CLI (`node $WS/dist/cli/index.js`, built from this branch's HEAD).
Host: this machine. Project: `panopticon-cli`.

`WS=/home/eltmon/Projects/overdeck/workspaces/feature-pan-4728`
`CLI="node $WS/dist/cli/index.js"`
Scratch: `$WS/.tmp/pan-4728-live/` (gitignored `.tmp/`)

## Build

```
$ npm run build:contracts && npm run build:cli
✔ Build complete
```

`dist/cli/index.js` present and current.

## Add

```
$ $CLI skills pack add pstack --yes
Pack pstack
  Source       https://github.com/eltmon/plugins @ ae5650febf4320793844c12c4adaa937f417f8da (ae5650f)
  Root         harness/pstack/claude-code
  Adapter      claude-plugin
  License      MIT
  Skills       58 (7 opt-in: automate-me, create-formal-verification-skill, create-verification-skill, maintain-verification-skill, make-bot-ui, reflect, setup-pstack)
  Executables  harness/pstack/claude-code/skills/poteto-mode/scripts/check-plan.mjs, harness/pstack/claude-code/skills/poteto-mode/scripts/watch-pr/watch-pr, harness/pstack/claude-code/skills/poteto-mode/scripts/worktree-audit.sh, …
  Not applied  agents, executables (6), project-mutating skills (7)
Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack pstack on
Trusted pstack @ ae5650f.
```

```
$ $CLI skills pack list --offline --json
... pstack entry: "skills": 58, "adapter": "claude-plugin", "license": "MIT",
    "notApplied": ["agents", "executables (6)", "project-mutating skills (7)"]
```

Matches the FR-12 preview exactly.

## Project level

```
$ $CLI skills set --pack pstack on --project panopticon-cli
pstack (pack): on at project panopticon-cli

$ $CLI skills launch-settings --harness claude-code --cwd "$WS" --plugin-link "$WS/.tmp/pan-4728-live/project-link"
[launcher] deft: pack off; project not directive; read-only

$ ls "$WS/.tmp/pan-4728-live/project-link/pstack/skills" | wc -l
51

$ test -f "$WS/.tmp/pan-4728-live/project-link/pstack/docs/harness/claude-code.md" && echo ok
ok

$ test -e "$WS/.tmp/pan-4728-live/project-link/pstack/skills/setup-pstack" || echo absent
absent
```

51 mounted skills (58 minus the 7 opt-in), the adapter doc present via mount
extras, and the opt-in `setup-pstack` correctly excluded.

## Invocation

```
$ claude -p --plugin-dir "$WS/.tmp/pan-4728-live/project-link" --model haiku "/pstack:principle-laziness-protocol In one sentence, name the principle this skill applies."
This skill applies a "laziness" principle: keep each decision in one place, and make the smallest change that solves the problem.
```

(Two unrelated permission-rule-syntax warnings about this workspace's own
`.claude/settings.local.json` printed first; they are pre-existing and
unrelated to the pack mount.)

The slash invocation resolved and the reply describes the deletion /
smallest-change principle, not an unknown-command error. No checkpoint
fallback needed.

## Cleanup

```
$ $CLI skills set --pack pstack inherit --project panopticon-cli
pstack (pack): inherit at project panopticon-cli

$ $CLI skills launch-settings --harness claude-code --cwd "$WS" --plugin-link "$WS/.tmp/pan-4728-live/after-link"
[launcher] deft: pack off; project not directive; read-only

$ test -e "$WS/.tmp/pan-4728-live/after-link" || echo absent
absent

$ $CLI skills pack gc --max-age-days 0
Removed 1 mount(s) and 0 dangling launch link(s).

$ $CLI skills list --project panopticon-cli | grep -A2 pstack
pstack   off   default
  pstack/architect   off   default
  pstack/arena   off   default
  ...
```

End state: pstack registered at `ae5650f`, every toggle off/inherit (default),
no mount, no launch link, scratch dir removed.
