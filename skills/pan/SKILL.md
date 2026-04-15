---
name: pan
description: "pan <verb> <args> — umbrella dispatch for all Panopticon CLI commands. Invoke bare to see the six-bucket taxonomy, or pass a full command to run it."
triggers:
  - pan help
  - pan commands
  - what can pan do
  - panopticon help
allowed-tools:
  - Bash
  - Read
---

# Panopticon CLI Umbrella Skill

Dispatch to any `pan` command, or show the full command taxonomy.

## Usage

**Invoked bare** (`/pan`): prints the six-bucket taxonomy as an index.

**Invoked with args** (`/pan start PAN-415`, `/pan show PAN-705 --cv`, `/pan admin cloister status`): runs the command directly.

## Command Taxonomy (0.7.0)

```
LIFECYCLE VERBS (top-level)
  pan start <id>           Spawn work agent for an issue
  pan tell <id> <msg>      Send message to running agent
  pan kill <id>            Stop a running agent
  pan resume <id>          Resume a paused agent
  pan recover <id>         Recover a crashed agent
  pan sync-main <id>       Sync latest main into feature branch
  pan done <id>            Mark work complete + signal pipeline
  pan approve <id>         Approve work and merge
  pan reopen <id>          Reopen a completed issue
  pan wipe <id>            Destructive reset-to-Todo for an issue
  pan close <id>           Close-out ceremony for completed issues
  pan plan <id>            Create execution plan
  pan plan finalize <id>   Materialize plan to beads
  pan issues               List and triage work across trackers

OBSERVATION
  pan show <id>            Summary: shadow state + CV + health
  pan show <id> --cv       Agent work history
  pan show <id> --context  Context engineering state
  pan show <id> --health   Health + heartbeat only

REVIEW
  pan review pending        Completed work awaiting review
  pan review request <id>   Request re-review after fixing feedback
  pan review reset <id>     Reset review/test/merge cycles
  pan review reset <id> --session  Also clears saved Claude session

MANAGED NOUNS
  pan workspace <subcommand>  Workspace lifecycle
  pan project <subcommand>    Project configuration
  pan convoy <subcommand>     Multi-agent convoys
  pan cost <subcommand>       Cost tracking

SYSTEM / DAEMON
  pan up / pan down           Start/stop dashboard
  pan status                  Running agents overview
  pan sync                    Sync skills/agents/rules to devroot
  pan doctor                  System health check

ADMIN (PLUMBING)
  pan admin cloister <cmd>    Lifecycle watchdog
  pan admin specialists <cmd> Review/test/merge agents
  pan admin remote <cmd>      Fly.io infra
  pan admin db <cmd>          Database seeding
  pan admin beads <cmd>       Beads CLI management
  pan admin config <cmd>      Configuration management
  pan admin hooks install     Install Claude Code heartbeat hooks
  pan admin tldr <cmd>        TLDR daemon management
  pan admin fpp <cmd>         FPP hooks
  pan admin tracker <cmd>     Tracker-specific operations
  pan admin migrate-config    Migrate settings.json → config.yaml
```

## Dispatch

If you were invoked with arguments, run the corresponding `pan` command now:

```bash
pan <args>
```

Replace `<args>` with the full command string the user specified.
