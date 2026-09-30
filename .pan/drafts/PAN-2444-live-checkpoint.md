# PAN-2444 live checkpoint (O8)

Run on 2026-09-29 (20:18 to 20:21 EDT) by the PAN-2444 work agent. It uses the fork build and this branch's CLI build, under an isolated `OVERDECK_HOME`. The real `~/.overdeck/config.yaml` never had the pack registered: after the run, neither the real `config.yaml` nor `projects.yaml` contains `sageox`, `sgx` or the scratch path. See "Anomalies" for one unrelated write to the real config during the run.

## Setup

- `$S` = the agent's scratch dir (`/tmp/claude-1000/.../scratchpad/o8`).
- `OVERDECK_HOME=$S/home`. `projects.yaml` registers one throwaway project `sgx` whose git root `$S/repo` has a hand-made `.sageox/config.json` (`{}`) and no `.sageox/.gitignore`.
- Fork build: `~/Projects/ox-pan-2444/bin/ox`, built with `go build -o bin/ox ./cmd/ox` at `overdeck/host-managed` `de597179542aca4a4815e0b6ab49f75809fa3be7` ([eltmon/ox#1](https://github.com/eltmon/ox/pull/1)). `ox host-contract --json` reports that commit.
- Upstream build: the host's `~/.local/bin/ox` (`ox 0.2.0`).
- This branch's CLI: `npm run build:cli`, run as `node dist/cli/index.js` (`$PAN` below).
- `ox` commands ran with `HOME` and `XDG_*` pointed at `$S/oxhome`, so the operator's real `~/.sageox` state was not touched.

## 1. Register the pack from the fork and turn it on (project level)

```
$ $PAN skills pack add sageox https://github.com/eltmon/ox --ref overdeck/host-managed --yes
Pack sageox
  Source       https://github.com/eltmon/ox @ overdeck/host-managed (de59717)
  Adapter      plain
  License      MIT
  Skills       24 (9 opt-in: ox-cli-attest, ox-cli-cart, ox-cli-cart-done, ox-cli-cart-drop, ox-cli-cart-start, ox-cli-init, ox-cli-plan, ox-cli-pr-header, ox-cli-skill-manager)
  Executables  none
  Not applied  project-mutating skills (9)
Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack sageox on
Trusted sageox @ de59717.
exit=0
$ $PAN skills set --pack sageox on --project sgx
sageox (pack): on at project sgx
exit=0
$ $PAN skills pack sageox status --json
{
  "registered": true,
  "projects": [
    {
      "project": "sgx",
      "pack": "on",
      "packSource": "project",
      "upload": "disabled"
    }
  ]
}
```

## 2. `launch-settings` with the fork `ox` first on PATH

`PATH=~/Projects/ox-pan-2444/bin:$PATH $PAN skills launch-settings --harness claude-code --cwd $S/repo --plugin-link $S/launch-fork/skill-packs`: exit 0, stderr empty. The six hook events are `PostToolUse, PreCompact, SessionEnd, SessionStart, Stop, UserPromptSubmit`. Uploads are off, so the network is off and publishing is manual. The mount holds the 15 non-opt-in skills (`ox-cli-consult … ox-cli-viz`, `sageox`) and none of the 9 opt-in ones.

```json
{
  "env": {
    "OX_HOST_MANAGED": "1",
    "OX_PROJECT_ROOT": "$S/repo",
    "OX_HOST_NETWORK": "off",
    "OX_SESSION_PUBLISHING": "manual",
    "SAGEOX_TELEMETRY": "false",
    "SAGEOX_FRICTION": "false",
    "SAGEOX_DAEMON": "false",
    "OX_NO_DAEMON": "1"
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 OX_PROJECT_ROOT=$S/repo OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual SAGEOX_TELEMETRY=false SAGEOX_FRICTION=false SAGEOX_DAEMON=false OX_NO_DAEMON=1 AGENT_ENV=claude-code ox agent hook SessionStart 2>&1 || true; fi"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 OX_PROJECT_ROOT=$S/repo OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual SAGEOX_TELEMETRY=false SAGEOX_FRICTION=false SAGEOX_DAEMON=false OX_NO_DAEMON=1 AGENT_ENV=claude-code ox agent hook PreCompact 2>&1 || true; fi"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 OX_PROJECT_ROOT=$S/repo OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual SAGEOX_TELEMETRY=false SAGEOX_FRICTION=false SAGEOX_DAEMON=false OX_NO_DAEMON=1 AGENT_ENV=claude-code ox agent hook PostToolUse 2>&1 || true; fi"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 OX_PROJECT_ROOT=$S/repo OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual SAGEOX_TELEMETRY=false SAGEOX_FRICTION=false SAGEOX_DAEMON=false OX_NO_DAEMON=1 AGENT_ENV=claude-code ox agent hook Stop 2>&1 || true; fi"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 OX_PROJECT_ROOT=$S/repo OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual SAGEOX_TELEMETRY=false SAGEOX_FRICTION=false SAGEOX_DAEMON=false OX_NO_DAEMON=1 AGENT_ENV=claude-code ox agent hook SessionEnd 2>&1 || true; fi"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v ox >/dev/null 2>&1; then OX_HOST_MANAGED=1 OX_PROJECT_ROOT=$S/repo OX_HOST_NETWORK=off OX_SESSION_PUBLISHING=manual SAGEOX_TELEMETRY=false SAGEOX_FRICTION=false SAGEOX_DAEMON=false OX_NO_DAEMON=1 AGENT_ENV=claude-code ox agent hook UserPromptSubmit 2>&1 || true; fi"
          }
        ]
      }
    ]
  }
}
```

## 3. `launch-settings` with upstream `ox` 0.2.0 on PATH

`PATH=~/.local/bin:$PATH $PAN skills launch-settings --harness claude-code --cwd $S/repo --plugin-link $S/launch-upstream/skill-packs`: exit 0, stdout empty (0 bytes, so no settings JSON), no plugin link created. stderr:

```
[launcher] WARNING: SageOx not applied: ox host contract probe failed (no-contract); see pan doctor
```

## 4. Fork `ox agent hook` under the host-managed env

Env = the section 2 env map plus `AGENT_ENV=claude-code`; stdin = a SessionStart payload.

```
== uninitialized repo: ox agent hook SessionStart
[exit=0]
== git status --porcelain (uninit):
[end]
== uninitialized repo: ox agent prime
[exit=0]
== initialized repo (.sageox/ only): hooks SessionStart, Stop
- visualization-guidance: diagram and viz conventions for PRs and plans
</deferred>

</ox-prime>
[exit=0]
[exit=0]
== git status --porcelain (initialized):
?? .sageox/agent_instances/o8/agent_instances.jsonl
?? .sageox/agent_instances/o8/agent_instances.jsonl.lock
[end]
```

- In the uninitialized repo, `ox agent hook SessionStart` and `ox agent prime` exit 0, print nothing, and `git status --porcelain` is empty.
- The initialized-repo output has no `Co-Authored-By`, `Guided by SageOx`, `<attribution>`, `ox login` or `ox init` text (counted with grep: 0 each).
- The two untracked `.sageox/agent_instances/...` files are ox runtime state inside `.sageox/`. A real `ox init` writes `.sageox/.gitignore` with `agent_instances/`, which hides them (the fork's E2E tests, which use real init, show an empty `git status`). This checkpoint's hand-made `.sageox/` had no `.gitignore`, so they show.

## 5. `pan doctor` both ways

Only the SageOx row differs between the two runs, apart from the Codex CLI version, which resolves differently under each PATH. Both runs exit 1 because of checks unrelated to SageOx that the isolated home cannot satisfy: `Terminal backend`/`Herdr server` (no Herdr session for this home) and the missing `Skills`/`Commands`/`Agents` directories (never synced into the scratch home).

With the fork `ox`:

```

Overdeck Doctor

Checking system health...

[boot-timing] cache.db opened (WAL replay) at +16ms
[boot-timing] cache.db opened (WAL replay) at +0ms
✓ Git: Installed
✓ tmux: Installed
✓ Node.js: Installed
✓ Claude CLI: Installed
✓ GitHub CLI: Installed
✓ Docker: Installed
✓ Claude login: Signed in (max)
✓ GitHub login: Signed in
✓ oh-my-pi (omp): v17.4.1
✓ ohmypi Extension Bundle: ohmypi extension bundle present
✓ Codex CLI: v0.159.0
✓ Codex model floor: gpt-6-sol: Codex CLI 0.159.0 meets 0.156.1
✓ Codex model floor: gpt-6-luna: Codex CLI 0.159.0 meets 0.156.1
✓ Kimi Code CLI: 2.0.1
✓ SageOx (ox): host contract overdeck-host/1, ox 0.19.0; commit matches pack
✓ Prime Agent: 0.8.0 (supported 0.8.0 – <0.9.0)
✓ Claude Code: 2.1.284 (npm global, /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/claude)
✓ Claude Code for Claude Sonnet 5.5: needs 2.1.284; have 2.1.284 (roles.work.model, roles.review.sub.correctness.model, roles.review.sub.performance.model, roles.review.sub.requirements.model, roles.test.model, roles.ship.model, roles.worker.model, workhorses.mid, models.default_conversation_model)
⚠ Claude Code shadow: /usr/local/bin/claude is Claude Code 2.0.19; Overdeck launches /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/claude (2.1.284). A shell that runs `claude` may get the older one.
  Fix: Remove or upgrade the other binary so your shell and Overdeck run the same Claude Code.
✓ Ollama: 0.34.4 at http://localhost:11434
✗ Terminal backend: herdr selected but unavailable: The 'herdr' binary is at /home/eltmon/.local/bin/herdr but its 'overdeck-1e072d79' session socket /home/eltmon/.config/herdr/sessions/overdeck-1e072d79/herdr.sock does not exist.
  Fix: Run: pan install
✓ Herdr binary: 0.9.1 at /home/eltmon/.local/bin/herdr (channel stable)
✗ Herdr server: not running (session overdeck-1e072d79, socket /home/eltmon/.config/herdr/sessions/overdeck-1e072d79/herdr.sock)
  Fix: Run: pan sync
✓ Herdr config: resume_agents_on_restore = false (~/.config/herdr/config.toml)
✓ Herdr integration: pi: current (v9) (/home/eltmon/.pi/agent/extensions/herdr-agent-state.ts)
✓ Herdr integration: omp: current (v10) (/home/eltmon/.omp/agent/extensions/herdr-omp-agent-state.ts)
✓ Herdr integration: claude: not installed (not managed by Overdeck — session-identity only)
✓ Herdr integration: codex: not installed (not managed by Overdeck — session-identity only)
✓ Herdr integration: kimi: current (v7) (/home/eltmon/.kimi-code/hooks/herdr-agent-state.sh)
✓ Herdr integration: opencode: current (v12) (/home/eltmon/.config/opencode/plugins/herdr-agent-state.js)
✓ Herdr integration: hermes: not installed (not managed by Overdeck — session-identity only)
✓ Overdeck Home: Exists (7 items)
✗ Skills Directory: Missing
  Fix: Run: pan init
✗ Commands Directory: Missing
  Fix: Run: pan init
✗ Agents Directory: Missing
  Fix: Run: pan init
✓ Claude Code Skills: 215 skills
⚠ Claude Code Commands: 0 commands
  Fix: Run: pan sync
⚠ Deployed Hooks: 21/21 deployed hooks differ from /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444/sync-sources (ask-user-question-hook, auto-approve-hook, codex-notify-hook, gh-issue-trailer-hook, gh-issue-trailer-hook.js, +16 more)
  Fix: Run: pan sync
⚠ Sync Sources Checkout: sync sources checkout /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444 is on branch 'feature/pan-2444', not the default branch 'main'. (compared with the last-fetched origin/feature/pan-2444; doctor does not fetch)
  Fix: Update /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444 to origin/feature/pan-2444 (e.g. `git -C /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444 pull --ff-only` on main), then run `pan sync`
✓ OKF Skill Version: OKF skill v0.1.0 installed in 2 harness dir(s)
✓ CLI Generation: global CLI links outside deployments (/home/eltmon/.overdeck/deployments/dashboard/.pan-reload-generation-b) — operator-managed
✓ Config File: ~/.overdeck.env exists
✓ LINEAR_API_KEY: Set in environment
✓ Running Agents: 0 agent sessions
✓ Closed-Issue Agent Dirs: No old closed-issue agent dirs detected
✓ Tracker Rate Limits: All trackers within rate limits
✓ Project Tracker Config: Every project resolves a tracker
✓ Stopped-List Classification: No running agent state disagrees with tmux liveness
✓ orphan-proposed-specs: No proposed specs without matching work agents detected
⚠ Tiered execution: roles.work.model: claude-sonnet-5-5 is a workhorse-class model but this tier owns expert — items at that difficulty need at least frontier-class
  Fix: Adjust the tier model in Settings › Tiered Execution (warning only — a cheap model may be deliberate). With tiered execution off, enable it to route expert items to a frontier tier.
✓ Memory extraction: no memory extraction activity recorded
✓ Main Divergence: sgx (SageOx checkpoint): local main ahead 0, behind 0 relative to origin/main
✓ Plan home .pan/ tracking: .pan/ is committable in 1 plan home
✓ smee-client Webhook Relay: Running
✓ Docker Compose Labels: No compose path drift detected
⚠ Docker default-address-pools: /etc/docker/daemon.json does not declare default-address-pools
  Fix: Add a wider pool to /etc/docker/daemon.json and restart Docker:
{
  "default-address-pools": [
    { "base": "10.200.0.0/16", "size": 24 }
  ]
}
✓ inotify watch budget: 75,486 of 1,048,576 watches in use (7%); 169 of 8,192 instances
✓ inotify limit persistence: fs.inotify.max_user_watches=1,048,576 persisted in sysctl config
✓ Legacy Command Aliases: No legacy pan work/* aliases found in shell config
Patrol firing budgets (current UTC day):
  (no patrol actions recorded today)

Some required components are missing.
Fix the errors above before using Overdeck.
```

With upstream `ox` 0.2.0:

```

Overdeck Doctor

Checking system health...

[boot-timing] cache.db opened (WAL replay) at +1ms
[boot-timing] cache.db opened (WAL replay) at +0ms
✓ Git: Installed
✓ tmux: Installed
✓ Node.js: Installed
✓ Claude CLI: Installed
✓ GitHub CLI: Installed
✓ Docker: Installed
✓ Claude login: Signed in (max)
✓ GitHub login: Signed in
✓ oh-my-pi (omp): v17.4.1
✓ ohmypi Extension Bundle: ohmypi extension bundle present
✓ Codex CLI: v0.157.1
✓ Codex model floor: gpt-6-sol: Codex CLI 0.157.1 meets 0.156.1
✓ Codex model floor: gpt-6-luna: Codex CLI 0.157.1 meets 0.156.1
✓ Kimi Code CLI: 2.0.1
⚠ SageOx (ox): upstream ox, no host contract
  Fix: build ox from the eltmon/ox commit trusted by the sageox pack: go build -o ~/.local/bin/ox ./cmd/ox
✓ Prime Agent: 0.8.0 (supported 0.8.0 – <0.9.0)
✓ Claude Code: 2.1.284 (npm global, /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/claude)
✓ Claude Code for Claude Sonnet 5.5: needs 2.1.284; have 2.1.284 (roles.work.model, roles.review.sub.correctness.model, roles.review.sub.performance.model, roles.review.sub.requirements.model, roles.test.model, roles.ship.model, roles.worker.model, workhorses.mid, models.default_conversation_model)
⚠ Claude Code shadow: /usr/local/bin/claude is Claude Code 2.0.19; Overdeck launches /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/claude (2.1.284). A shell that runs `claude` may get the older one.
  Fix: Remove or upgrade the other binary so your shell and Overdeck run the same Claude Code.
✓ Ollama: 0.34.4 at http://localhost:11434
✗ Terminal backend: herdr selected but unavailable: The 'herdr' binary is at /home/eltmon/.local/bin/herdr but its 'overdeck-1e072d79' session socket /home/eltmon/.config/herdr/sessions/overdeck-1e072d79/herdr.sock does not exist.
  Fix: Run: pan install
✓ Herdr binary: 0.9.1 at /home/eltmon/.local/bin/herdr (channel stable)
✗ Herdr server: not running (session overdeck-1e072d79, socket /home/eltmon/.config/herdr/sessions/overdeck-1e072d79/herdr.sock)
  Fix: Run: pan sync
✓ Herdr config: resume_agents_on_restore = false (~/.config/herdr/config.toml)
✓ Herdr integration: pi: current (v9) (/home/eltmon/.pi/agent/extensions/herdr-agent-state.ts)
✓ Herdr integration: omp: current (v10) (/home/eltmon/.omp/agent/extensions/herdr-omp-agent-state.ts)
✓ Herdr integration: claude: not installed (not managed by Overdeck — session-identity only)
✓ Herdr integration: codex: not installed (not managed by Overdeck — session-identity only)
✓ Herdr integration: kimi: current (v7) (/home/eltmon/.kimi-code/hooks/herdr-agent-state.sh)
✓ Herdr integration: opencode: current (v12) (/home/eltmon/.config/opencode/plugins/herdr-agent-state.js)
✓ Herdr integration: hermes: not installed (not managed by Overdeck — session-identity only)
✓ Overdeck Home: Exists (10 items)
✗ Skills Directory: Missing
  Fix: Run: pan init
✗ Commands Directory: Missing
  Fix: Run: pan init
✗ Agents Directory: Missing
  Fix: Run: pan init
✓ Claude Code Skills: 215 skills
⚠ Claude Code Commands: 0 commands
  Fix: Run: pan sync
⚠ Deployed Hooks: 21/21 deployed hooks differ from /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444/sync-sources (ask-user-question-hook, auto-approve-hook, codex-notify-hook, gh-issue-trailer-hook, gh-issue-trailer-hook.js, +16 more)
  Fix: Run: pan sync
⚠ Sync Sources Checkout: sync sources checkout /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444 is on branch 'feature/pan-2444', not the default branch 'main'. (compared with the last-fetched origin/feature/pan-2444; doctor does not fetch)
  Fix: Update /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444 to origin/feature/pan-2444 (e.g. `git -C /home/eltmon/Projects/overdeck/workspaces/feature-pan-2444 pull --ff-only` on main), then run `pan sync`
✓ OKF Skill Version: OKF skill v0.1.0 installed in 2 harness dir(s)
✓ CLI Generation: global CLI links outside deployments (/home/eltmon/.overdeck/deployments/dashboard/.pan-reload-generation-b) — operator-managed
✓ Config File: ~/.overdeck.env exists
✓ LINEAR_API_KEY: Set in environment
✓ Running Agents: 0 agent sessions
✓ Closed-Issue Agent Dirs: No old closed-issue agent dirs detected
✓ Tracker Rate Limits: All trackers within rate limits
✓ Project Tracker Config: Every project resolves a tracker
✓ Stopped-List Classification: No running agent state disagrees with tmux liveness
✓ orphan-proposed-specs: No proposed specs without matching work agents detected
⚠ Tiered execution: roles.work.model: claude-sonnet-5-5 is a workhorse-class model but this tier owns expert — items at that difficulty need at least frontier-class
  Fix: Adjust the tier model in Settings › Tiered Execution (warning only — a cheap model may be deliberate). With tiered execution off, enable it to route expert items to a frontier tier.
✓ Memory extraction: no memory extraction activity recorded
✓ Main Divergence: sgx (SageOx checkpoint): local main ahead 0, behind 0 relative to origin/main
✓ Plan home .pan/ tracking: .pan/ is committable in 1 plan home
✓ smee-client Webhook Relay: Running
✓ Docker Compose Labels: No compose path drift detected
⚠ Docker default-address-pools: /etc/docker/daemon.json does not declare default-address-pools
  Fix: Add a wider pool to /etc/docker/daemon.json and restart Docker:
{
  "default-address-pools": [
    { "base": "10.200.0.0/16", "size": 24 }
  ]
}
✓ inotify watch budget: 75,486 of 1,048,576 watches in use (7%); 169 of 8,192 instances
✓ inotify limit persistence: fs.inotify.max_user_watches=1,048,576 persisted in sysctl config
✓ Legacy Command Aliases: No legacy pan work/* aliases found in shell config
Patrol firing budgets (current UTC day):
  (no patrol actions recorded today)

Some required components are missing.
Fix the errors above before using Overdeck.
```

## Anomalies

- The real `~/.overdeck/config.yaml` changed at 20:19:32, between the hash taken at 20:18:50 and the doctor runs. The checkpoint did not cause it. The `ox` commands ran with a scratch `HOME`. The `$PAN` commands ran with `OVERDECK_HOME=$S/home` and had finished by 20:19:16. A re-run of the isolated `pan doctor` left the real file byte-identical (mtime `20:19:32.55`, sha256 `10b1c336…`, before and after). The real file has no `sageox`, `sgx` or scratch-path entries. The live dashboard and the other running agents share that file.
