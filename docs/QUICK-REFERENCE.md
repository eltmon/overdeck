# Panopticon Quick Reference

**The fast path through `pan`.** Commands are organized by what you're trying to *do*, not by internal structure. `<id>` is always an issue id (e.g. `PAN-415`, `MIN-794`).

> **Status:** This document reflects the **target command taxonomy** from the command reorganization (see [PRD](prds/planned/pan-command-taxonomy-reorg.md)). Some commands may still live at their legacy paths until the reorg ships.

---

## TL;DR — the happy path

```bash
pan issues                       # what can I work on?
pan plan <id>                    # create an execution plan
pan plan finalize <id>           # materialize plan → beads
pan start <id>                   # spawn an agent on the issue
pan status                       # what's running right now?
pan show <id>                    # everything about one issue
pan tell <id> "message"          # talk to a running agent
pan review pending               # what's waiting on me?
pan done <id> → MERGE button     # hand off → merge (human clicks in dashboard)
pan close <id>                   # close out on the tracker
```

---

## 1. Issue lifecycle

Act on an issue. `<id>` is the universal object.

| Command | What it does |
|---|---|
| `pan issues` | List + triage work across configured trackers |
| `pan plan <id>` | Create execution plan (interactive discovery by default) |
| `pan plan finalize <id>` | Materialize plan → beads, write completion marker |
| `pan start <id>` | Create workspace + spawn agent |
| `pan tell <id> <msg>` | Send a message to a running agent |
| `pan resume <id>` | Resume from saved Claude session |
| `pan recover <id>` | Recover a crashed or stopped agent |
| `pan kill <id>` | Stop the agent (workspace preserved) |
| `pan sync-main <id>` | Merge latest `main` into the workspace branch |
| `pan done <id>` | Mark work complete → tracker "In Review". Agent stays on standby for UAT tweaks via `pan tell`. |
| Dashboard MERGE | Click MERGE button when review passes (handles rebase, verify, merge, cleanup) |
| `pan inspect <id>` | Request human inspection before proceeding |
| `pan close <id>` | Verify, clean up, close on tracker |
| `pan reopen <id>` | Re-open for rework (resets specialist state) |
| `pan wipe <id>` | **Destructive.** Canonical reset-to-Todo for an issue. Confirms. |

## 2. Observation

See what's happening — in aggregate and for specific issues.

| Command | What it does |
|---|---|
| `pan status` | All running agents across all projects |
| `pan show <id>` | Unified lens: shadow + cv + context + health for one issue |
| `pan show <id> --cv` | Agent work history only |
| `pan show <id> --context` | Context engineering state |
| `pan show <id> --health` | Health + heartbeat only |
| `pan logs <agent-id\|dashboard>` | Tail high-level dashboard or agent logs |
| `less ~/.panopticon/agents/agent-<id>/lifecycle.log` | Inspect exact start/resume/stop lifecycle steps |
| `less ~/.panopticon/agents/agent-<id>/spawn.log` | Inspect detached `pan start <id> --local --phase <phase>` stdout/stderr |
| Dashboard Start/Resume action | Shows `Starting...` / `Resuming...` first, then flips to live controls once the tmux-backed agent is actually running |
| `pan review pending` | Completed work awaiting review |
| `pan review request <id>` | Request re-review after fixing feedback |
| `pan review reset <id>` | Reset review/test/merge cycles (human override) |
| `pan review reset <id> --session` | Also clear saved Claude session |

## 3. Things you manage

Noun-first because you're managing the thing itself, not advancing an issue through its lifecycle.

### `pan workspace`
```
create <id>           Create workspace for issue
destroy <id>          Destroy workspace
list                  List all workspaces
ssh <id>              SSH into remote workspace VM
start <id>            Start a hibernated remote workspace
stop <id>             Hibernate a remote workspace
migrate <id>          Migrate between local and remote
update <id>           Update skills/agents/rules in existing workspace
add-repo <ws> <repo>  Add repo to progressive polyrepo workspace
sync-auth <id>        Sync Claude credentials to remote
```

### `pan project`
```
add <path>            Register a project
list                  List all registered projects
show <key>            Show details for a project
remove <name|path>    Remove a project
init                  Initialize projects.yaml from template
```

### `pan convoy`
```
start <template>      Start a new convoy
status [convoy-id]    Show convoy status
list                  List all convoys
stop <convoy-id>      Stop a running convoy
```

### `pan cost`
```
today | week | month        Time-windowed summaries
report                      Generate a cost report
issue <id>                  Costs for a specific issue
budget                      Manage cost budgets
sync                        Import cost events from per-project WAL
```

### `pan test`
```
run [target]          Run tests for a project or workspace
list [project]        List configured tests
```

## 4. System / daemon

```
pan up                Start dashboard (and Traefik if enabled)
pan down              Stop dashboard (and Traefik if enabled)
pan serve             One-shot npx launcher (dashboard + open browser)
```

## 5. Releases

Panopticon develops on `main`, then publishes intentionally by tag.

```
pan release check                         Verify branch, tree, build, tests, CLI
pan release stable [--version <x.y.z>]    Create stable release commit + tag locally
pan release canary [--version <x.y.z-canary.n>]
                                          Create canary release commit + tag locally
pan release notes [from] [to]             Draft notes from git history
                                          (use --write to save a release body file)
```

Stable tags publish npm `latest`; canary tags publish npm `canary` and create GitHub prereleases. GitHub release pages use a structured body with Summary, Highlights, Breaking changes, Install, and Full changelog.

## 6. First-run & maintenance

```
pan init              Initialize ~/.panopticon/
pan install           Install prerequisites (ttyd, beads, Traefik, mkcert)
pan setup             Interactive setup wizard
pan doctor            Check system health and dependencies
pan update            Update Panopticon to latest version
pan sync              Sync skills/agents/rules to devroot
pan backup            Manage backups
pan restore [ts]      Restore from backup
```

## 7. `pan admin` — plumbing

You should rarely need these. They're here for debugging, recovery, and infra ops.

### `pan admin cloister` — lifecycle watchdog
```
status | start | stop | emergency-stop
```
`emergency-stop` kills **all** agents immediately. Use when something is on fire.

### `pan admin specialists` — review/test/merge agents
```
list                  All specialists + status
wake <name>           Wake a specialist (debugging)
queue <name>          Show pending work
reset [name]          Clear session, start fresh
clear-queue <name>    Drop all queued items
done <type> <id>      Force completion status
logs [proj] [type]    View specialist run logs
cleanup-logs          Prune old logs
```

### `pan admin remote` — Fly.io infra
```
status | init | resources | setup
```

### `pan admin db` — database seeding
```
snapshot              Create snapshot from external source
seed <ws|id>          Seed workspace DB from configured seed file
status [ws|id]        Check DB status for a workspace
clean <file>          Clean kubectl/stderr garbage from pg_dump
config [project]      Show DB config for a project
```

### `pan admin beads` — beads CLI mgmt
```
compact               Remove old closed beads
stats                 Beads statistics
upgrade               Upgrade bd CLI
```

### `pan admin tracker` — tracker-specific ops
```
linear-states         Manage Linear workflow states
linear-cleanup        Archive old Linear custom states
```

### `pan admin config` — configuration
```
shadow                Manage shadow mode settings
```

### `pan admin hooks` — Claude Code hooks
```
install               Configure heartbeat hooks in settings.json
status                Show hook installation status
```

### `pan admin tldr` — TLDR daemon
```
status | start | stop | warm
```

### `pan admin fpp` — First-person-plural hooks (internal)
```
check | push | pop | clear | mail
```

### `pan admin migrate-config`
One-time migration from `settings.json` → `config.yaml`.

---

## Design principles behind this layout

1. **Top-level verbs act on issues.** If your question is "advance this issue to the next state," you should never have to guess which sub-noun to dig under.
2. **Noun-first groups manage the noun itself.** `pan workspace destroy` is about the workspace. `pan wipe <id>` is about the issue, even though it touches the workspace.
3. **`pan admin` holds plumbing.** If a command is on the happy path, it is **not** admin — promote it out.
4. **One verb = one question.** `pan show <id>` collapses shadow + cv + context + health because "what's going on with this issue?" is a single question, not four.
5. **Destructive commands confirm.** `wipe`, `destroy`, `emergency-stop`, `clear-queue` all require explicit confirmation.

## Migration from legacy commands

| Legacy | New |
|---|---|
| `pan work issue <id>` | `pan start <id>` |
| `pan work plan <id>` | `pan plan <id>` |
| `pan plan-finalize <id>` | `pan plan finalize <id>` |
| `pan work list` / `pan work triage` | `pan issues` |
| `pan work tell` / `kill` / `resume` / `recover` / `done` / `approve` / `reopen` / `wipe` / `sync-main` / `inspect` | drop the `work` prefix |
| `pan work close-out <id>` | `pan close <id>` |
| `pan work pending` | `pan review pending` |
| `pan work request-review <id>` | `pan review request <id>` |
| `pan work reset-review <id>` + `pan work reset-session <id>` | `pan review reset <id>` (`--session` for the latter) |
| `pan work shadow` / `cv` / `context` / `health` / `refresh` | `pan show <id>` (with flags) |
| `pan cloister *` | `pan admin cloister *` |
| `pan specialists *` | `pan admin specialists *` |
| `pan remote *` | `pan admin remote *` |
| `pan beads *` | `pan admin beads *` |
| `pan db *` | `pan admin db *` |
| `pan config *` | `pan admin config *` |
| `pan setup hooks` | `pan admin hooks install` |
| `pan work hook *` | `pan admin fpp *` |
| `pan work tldr *` | `pan admin tldr *` |
| `pan work linear-states` / `linear-cleanup` | `pan admin tracker linear-*` |
| `pan migrate-config` | `pan admin migrate-config` |
| `pan sync-costs` | `pan cost sync` |
