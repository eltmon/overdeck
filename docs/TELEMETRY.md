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
installation. Overdeck does not derive identity from Claude Code, Codex, Git,
GitHub, or any other credential or account file.

## Event schema

Every event is defined in `packages/contracts/src/telemetry.ts`. Product event
properties are closed unions of enums, booleans, and coarse buckets. The schema
drift test fails when this table and the typed contract disagree.

| Event | Properties | Meaning |
| --- | --- | --- |
| `dashboard_tab_viewed` | `tab` (dashboard-tab enum) | A top-level dashboard tab became active. |
| `agent_spawned` | `spawn_mode` (`spawn-and-send` or `spawn-work-and-send`), `has_message` (boolean) | An operator started an agent from the dashboard. |
| `project_created` | `mode` (`existing` or `new`) | The project wizard registered or created a project. |
| `issue_merged` | `merge_kind` (`pipeline`) | The dashboard merge action completed. |
| `force_merge_triggered` | `forge` (`github` or `gitlab`) | An operator invoked force merge. |
| `issue_closed_out` | `variant` (`card` or `inspector`) | A dashboard close-out action completed. |
| `bulk_close_out_initiated` | `issue_count` (count bucket) | The operator started bulk close-out. |
| `auto_merge_toggled` | `auto_merge` (boolean), `variant` (`segmented` or `badge`) | The operator changed an issue's auto-merge mode. |
| `conversation_forked` | `fork_intent`, `fork_mode` (`summary`, `handoff`, or `plain`), `fast_summary` (boolean), `launch_harness` (harness enum) | A conversation fork was launched. |
| `plan_approved` | `subject_kind` (`agent` or `conversation`) | An operator approved a plan decision. |
| `plan_changes_requested` | `subject_kind` (`agent` or `conversation`) | An operator requested plan changes. |
| `agent_question_answered` | `subject_kind` (`agent` or `conversation`), `answer_type` (`custom` or `selection`), `question_count` (count bucket) | An operator answered an agent question. |
| `server_boot` | `project_count`, `active_agent_count` (count buckets) | A dashboard server reached the listening state. |
| `cli_command_run` | `verb` (allowlisted CLI verb), `ok` (boolean), `duration_ms` (duration bucket) | A CLI command completed. |
| `pipeline_stage_changed` | `stage` (`merged`, `verification_passed`, or `closed_out`), `harness` (harness enum), `model` (model-family enum) | An issue crossed a pipeline funnel stage. |

Count buckets are `0`, `1-2`, `3-5`, `6-10`, and `11+`. Duration buckets are
`under_100ms`, `100ms-999ms`, `1s-9s`, and `10s+`; raw counts and timings are
not sent.

Node events also receive the anonymous install ID and the centrally stamped
`$process_person_profile: false`, platform, architecture, Overdeck version, and
client type. The frontend registers the same install ID and configures PostHog
for identified-only person profiles, so anonymous product events do not create
person profiles.

## Error tracking and source maps

The frontend SDK captures browser exceptions, and the server SDK enables Node
exception autocapture. Frontend production builds generate hidden source maps:
the JavaScript bundles contain no `sourceMappingURL` comments. The release
workflow injects and uploads the exact CI-built bundle when
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
