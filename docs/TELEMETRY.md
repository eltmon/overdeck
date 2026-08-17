# Anonymous telemetry

Overdeck sends anonymous product-usage and error telemetry to PostHog so the
maintainers can see which product surfaces are used, where the issue pipeline
stalls, and which failures occur on real installations. Telemetry is enabled by
default and can be disabled at runtime without rebuilding Overdeck.

Session replay is not enabled. Overdeck never sends code, prompts, terminal
content, issue or repository identifiers, file paths, branch names, email
addresses, or credentials.

## Disable telemetry

Use any of these controls:

1. Turn off **Settings → Telemetry → Share anonymous usage data**.
2. Set the following in `~/.overdeck/config.yaml`:

   ```yaml
   telemetry:
     enabled: false
   ```

3. Set `OVERDECK_TELEMETRY=0` or `OVERDECK_TELEMETRY=false` in the process
   environment.

The environment variable wins over the YAML setting. Disabled telemetry does
not initialize either PostHog SDK and makes server, CLI, frontend, exception,
and feature-flag operations local no-ops.

## Anonymous install identity

The first telemetry-capable run creates a random UUIDv4 at
`~/.overdeck/telemetry-id`, or `${OVERDECK_HOME}/telemetry-id` when
`OVERDECK_HOME` is set. The file is created with mode `0600` and reused on that
installation. Invalid or partial file content is repaired under an exclusive
process lock with a stale-lock lease, then re-read so concurrent processes use
the same durable UUIDv4 with mode `0600`. Overdeck does not derive identity from Claude Code,
Codex, Git, GitHub, or any other credential or account file.

## Event schema

Every event is defined in `packages/contracts/src/telemetry.ts`. Product event
properties are closed unions of enums, booleans, and coarse buckets. The schema
drift test fails when this table and the typed contract disagree.

The Properties column uses `property=domain`. The domain table below is part of
the public contract and lists every allowed value.

| Event | Properties | Meaning |
| --- | --- | --- |
| `dashboard_tab_viewed` | `tab=dashboard_tab` | A top-level dashboard tab became active. |
| `agent_spawned` | `spawn_mode=agent_spawn_mode; has_message=boolean` | An operator started an agent from the dashboard. |
| `project_created` | `mode=project_mode` | The project wizard registered or created a project. |
| `issue_merged` | `merge_kind=merge_kind` | The dashboard merge action completed. |
| `force_merge_triggered` | `forge=forge` | An operator invoked force merge. |
| `issue_closed_out` | `variant=close_out_variant` | A dashboard close-out action completed. |
| `bulk_close_out_initiated` | `issue_count=count_bucket` | The operator started bulk close-out. |
| `auto_merge_toggled` | `auto_merge=boolean; variant=auto_merge_variant` | The operator changed an issue's auto-merge mode. |
| `conversation_forked` | `fork_intent=fork_kind; fork_mode=fork_kind; fast_summary=boolean; launch_harness=harness` | A conversation fork was launched. |
| `plan_approved` | `subject_kind=decision_subject` | An operator approved a plan decision. |
| `plan_changes_requested` | `subject_kind=decision_subject` | An operator requested plan changes. |
| `agent_question_answered` | `subject_kind=decision_subject; answer_type=answer_type; question_count=count_bucket` | An operator answered an agent question. |
| `server_boot` | `project_count=count_bucket; active_agent_count=count_bucket` | A dashboard server reached the listening state. |
| `cli_command_run` | `verb=cli_verb; ok=boolean; duration_ms=duration_bucket` | A CLI command completed. |
| `pipeline_stage_changed` | `stage=pipeline_stage; harness=harness; model=model_family` | An issue crossed a pipeline funnel stage. |

| Domain | Allowed values |
| --- | --- |
| `agent_spawn_mode` | `spawn-and-send`, `spawn-work-and-send` |
| `answer_type` | `custom`, `selection` |
| `auto_merge_variant` | `segmented`, `badge` |
| `boolean` | `false`, `true` |
| `cli_verb` | `abort`, `approve`, `backlog`, `backup`, `clean`, `context`, `destroy`, `dev`, `diff`, `doctor`, `done`, `down`, `edit`, `finalize`, `fork`, `handoff`, `health`, `init`, `issues`, `kill`, `list`, `migrate`, `mode`, `open`, `pause`, `pending`, `plan`, `project`, `projects`, `recover`, `reload`, `reopen`, `request`, `reset`, `restart`, `restore`, `resume`, `review`, `scope`, `serve`, `show`, `skills`, `spawn-reviewer`, `staffing`, `start`, `status`, `strike`, `sync`, `sync-main`, `tell`, `unarchive-conversation`, `unpause`, `untroubled`, `up`, `update`, `validate`, `wipe`, `write-sequence`, `other` |
| `close_out_variant` | `card`, `inspector` |
| `count_bucket` | `0`, `1-2`, `3-5`, `6-10`, `11+` |
| `dashboard_tab` | `home`, `pipeline`, `kanban`, `command-deck`, `agents`, `flywheel`, `orders`, `backlog`, `resources`, `knowledge`, `skills`, `context`, `health`, `activity`, `metrics`, `costs`, `autopreso`, `settings`, `god-view`, `deacon`, `sessions`, `awaiting-merge`, `workspace-new`, `workspace` |
| `decision_subject` | `agent`, `conversation` |
| `duration_bucket` | `under_100ms`, `100ms-999ms`, `1s-9s`, `10s+` |
| `forge` | `github`, `gitlab` |
| `fork_kind` | `summary`, `handoff`, `plain` |
| `harness` | `claude-code`, `ohmypi`, `codex`, `acp`, `kimi-code`, `prime-agent` |
| `merge_kind` | `pipeline` |
| `model_family` | `claude`, `gpt`, `gemini`, `kimi`, `minimax`, `glm`, `mimo`, `other` |
| `pipeline_stage` | `work_done`, `review_passed`, `verification_passed`, `merged`, `closed_out` |
| `project_mode` | `existing`, `new` |

Raw counts and timings are never sent. Pipeline attribution is emitted only
after the canonical pipeline-membership resolver confirms that the issue is in
the pipeline, so stale agent rows cannot supply harness or model metadata.

## Local DB job diagnostics

The dashboard logs slow worker jobs locally as
`[db-jobs] slow: op=<operation> lane=<lane> waitMs=<n> runMs=<n> depth=<n>` when
queue wait or execution exceeds one second. Use the lane, wait time, run time,
and queue depth to distinguish worker congestion from a slow operation. These
raw timings stay in local logs and are not sent as anonymous telemetry.

Node events also receive the anonymous install ID and the centrally stamped
`$process_person_profile: false`, platform, architecture, Overdeck version, and
client type. The frontend registers the same install ID and configures PostHog
for identified-only person profiles, so anonymous product events do not create
person profiles.

## Error tracking and source maps

Browser and Node exceptions pass through Overdeck's telemetry doors, which replace
raw messages and stack frames with a fixed categorical error before capture. The
browser SDK observes unhandled errors and rejections through a sanitized `before_send`
hook. Overdeck owns removable Node process listeners instead of enabling the SDK's raw
Node autocapture. Fatal Node exceptions retain their original message and stack
in local stderr, while PostHog receives only the sanitized category. The bounded
flush shares the two-second telemetry deadline, then the process exits nonzero.
Frontend production builds generate hidden source maps: the
JavaScript bundles contain no `sourceMappingURL` comments. The
release workflow injects and uploads the exact CI-built bundle when
`POSTHOG_CLI_API_KEY` is available, then removes the map files before npm
publishing. A missing key prints a warning and does not block the release.

## Feature flags

`AnalyticsService.isFeatureEnabled(flag, fallback)` is the only feature-flag
read door. An explicit local override wins, disabled or offline telemetry
returns the fallback, and remote evaluation is bounded at 500 milliseconds.
No production feature is controlled by a PostHog flag yet.

## Implementation boundaries

- Browser product events import only
  `src/dashboard/frontend/src/lib/telemetry.ts`; no component imports
  `posthog-js` directly.
- Node product events, exception capture, and flag evaluation use
  `src/lib/telemetry/service.ts`; no other production module imports
  `posthog-node` or sends directly to PostHog.
- Event names and property types come from `@overdeck/contracts`.
- The release workflow is the source-map upload owner because it rebuilds the
  dashboard bundle that is actually published.
