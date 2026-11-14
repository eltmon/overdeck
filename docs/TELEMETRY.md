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

`resolveTelemetryState()` (`src/lib/telemetry/config.ts`) is the one door for
effective state. Six rows, first match wins:

| Row | Check | Result |
| --- | --- | --- |
| 1 | `OVERDECK_TELEMETRY=0` or `OVERDECK_TELEMETRY=false` | off, reason `environment` |
| 2 | `telemetry.enabled: false` in config | off, reason `config` |
| 3 | `OVERDECK_TELEMETRY=1` or `OVERDECK_TELEMETRY=true` | on |
| 4 | Running in CI (see Automatic exclusions below) | off, reason `ci` |
| 5 | A temporary Overdeck home (see Automatic exclusions below) | off, reason `temporary_home` |
| 6 | None of the above | on |

`OVERDECK_TELEMETRY=1` only turns telemetry back on when an automatic
exclusion (row 4 or 5) would otherwise disable it. It never overrides an
explicit opt-out: `OVERDECK_TELEMETRY=0` (row 1) and `telemetry.enabled: false`
(row 2) both still win.

Disabled telemetry does not initialize either PostHog SDK and makes server,
CLI, frontend, exception, and feature-flag operations local no-ops.

## Automatic exclusions

Two environments are excluded from telemetry by default, without any
configuration:

- **CI runs.** Any process where `CI` is set to a truthy value (anything but
  empty, `0`, or `false`).
- **Temporary Overdeck homes.** An `OVERDECK_HOME` that resolves (symlinks
  included) inside `os.tmpdir()`, `/tmp`, or `~/.overdeck/tmp` — the homes test
  harnesses and throwaway scripts create per run.

`detectTelemetryAutoExclusion()` (`src/lib/telemetry/environment.ts`) makes
this decision from injectable inputs only, so it is unit-tested without
touching the real filesystem or environment. The reason it returns —
`ci` or `temporary_home` — is surfaced as `telemetry.disabledBy` from the
Settings API and shown in **Settings → Telemetry**.

Vitest (`VITEST` set) and `NODE_ENV=test` still block telemetry unconditionally,
as they did before automatic exclusions existed — a belt-and-braces check
inside `AnalyticsService`, independent of `resolveTelemetryState()`. Every CI
workflow (`ci.yml`, `windows-smoke.yml`) and every test harness that spawns a
real server or CLI process additionally sets `OVERDECK_TELEMETRY=0` itself, so
a CI run or test process never relies on the auto-exclusion alone.

## Install kind

Every event also carries `install_kind`, one of `user`, `remote_vm`,
`dev_checkout`, or `container`. `resolveInstallKind()`
(`src/lib/telemetry/install-kind.ts`) resolves it in this order, each probe
wrapped so a permission error falls through rather than throwing:

1. A marker file at `${OVERDECK_HOME}/install-kind`, when its trimmed content
   is one of the four values above.
2. `dev_checkout`, when `isDevMode()` detects a `src/` directory next to the
   installed package — true for a source checkout, including the dashboard
   this repository runs via `pan reload`.
3. `container`, when `/.dockerenv` or `/run/.containerenv` exists.
4. `user` otherwise.

Fly machine provisioning (PAN-5084) writes the `remote_vm` marker right after
the identity file, before `pan serve` starts, so every throwaway Fly VM
reports as a disposable install rather than a new one. The browser gets
`install_kind` from `/api/settings` and registers it as a PostHog super
property alongside the install ID, together with `client` (`desktop` or
`phone`), `platform` (`web`, `ios`, or `android`), `app_version` (phone
only), and `build_commit` (when the machine's build has one). Every browser
event, including `$exception`, carries these super properties.

## Anonymous install identity

The first telemetry-capable run creates a random UUIDv4 at
`~/.overdeck/telemetry-id`, or `${OVERDECK_HOME}/telemetry-id` when
`OVERDECK_HOME` is set. The file is created with mode `0600` and reused on that
installation. Invalid or partial file content is repaired under an exclusive
process lock with a stale-lock lease, then re-read so concurrent processes use
the same durable UUIDv4 with mode `0600`. Overdeck does not derive identity from Claude Code,
Codex, Git, GitHub, or any other credential or account file, except the opt-in
`operatorHash` described below, which is a salted one-way hash of the GitHub
numeric user id.

## Operator grouping (opt-in)

One operator often runs several installs (a Linux workstation and a Mac, for
example) that spend the same GitHub account's API quota. Operator grouping
lets those installs be grouped without identifying the operator.

- **Setting.** `telemetry.operator_grouping` in `~/.overdeck/config.yaml`,
  shown as **Settings → Telemetry → Group my installs (pseudonymous)**. It is
  off by default and disabled while telemetry is off.
- **Construction.** `operatorHash` = HMAC-SHA256 of the GitHub numeric user id
  under the fixed product salt `overdeck-operator-grouping-v1`, truncated to
  16 hex characters (`src/lib/telemetry/operator-hash.ts`). The id comes from
  `gh api user --jq .id`, once, when grouping is turned on or at dashboard
  boot. Only the hash is cached, at `~/.overdeck/telemetry-operator-hash`
  (mode `0600`); the raw id is never stored or sent. Without an authenticated
  `gh`, no hash exists and the property is omitted.
- **Salt caveat.** The salt is a pepper in the Overdeck source, not a secret.
  The hash is pseudonymous only against parties without the Overdeck source:
  anyone with the source and a candidate GitHub user id can recompute it.
- **What is sent.** With grouping on, every Node and browser event carries
  `operatorHash`. Nothing else changes: no GitHub login, email, hostname, user
  name, filesystem path, repository name or raw user id is sent
  (`tests/unit/lib/telemetry/github-telemetry-privacy.test.ts` enforces it).
- **Doctor remote view.** `pan doctor github-quota` lists the other installs
  that sent the same `operatorHash` in the last 48 hours (platform, arch,
  version, last seen, last `github_quota_sample` GraphQL buckets). It needs a
  PostHog personal API key with query access and the project id:
  `telemetry.posthog_read_key` and `telemetry.posthog_project_id` in
  `~/.overdeck/config.yaml`, or `OVERDECK_POSTHOG_READ_KEY` and
  `OVERDECK_POSTHOG_PROJECT_ID`. The query host is `POSTHOG_HOST` with `.i.`
  removed (default `https://us.posthog.com`). The key is never shown in the
  Settings UI.

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
| `conversation_forked` | `fork_intent=fork_kind; fork_mode=fork_kind; fast_summary=boolean; launch_harness=harness; fresh_start=boolean` | A conversation fork was launched. |
| `plan_approved` | `subject_kind=decision_subject` | An operator approved a plan decision. |
| `plan_changes_requested` | `subject_kind=decision_subject` | An operator requested plan changes. |
| `agent_question_answered` | `subject_kind=decision_subject; answer_type=answer_type; question_count=count_bucket` | An operator answered an agent question. |
| `server_boot` | `project_count=count_bucket; active_agent_count=count_bucket` | A dashboard server reached the listening state. |
| `cli_command_run` | `verb=cli_verb; ok=boolean; duration_ms=duration_bucket` | A CLI command completed. |
| `pipeline_stage_changed` | `stage=pipeline_stage; harness=harness; model=model_family` | An issue crossed a pipeline funnel stage. |
| `github_quota_sample` | `graphql_pipeline_membership=quota_points_bucket; rest_pipeline_membership=quota_points_bucket; graphql_pr_cache=quota_points_bucket; rest_pr_cache=quota_points_bucket; graphql_pr_sync=quota_points_bucket; rest_pr_sync=quota_points_bucket; graphql_ci_repair=quota_points_bucket; rest_ci_repair=quota_points_bucket; graphql_issue_poller=quota_points_bucket; rest_issue_poller=quota_points_bucket; graphql_close_out=quota_points_bucket; rest_close_out=quota_points_bucket; graphql_tracker_client=quota_points_bucket; rest_tracker_client=quota_points_bucket; graphql_app_rest=quota_points_bucket; rest_app_rest=quota_points_bucket; graphql_agent=quota_points_bucket; rest_agent=quota_points_bucket; graphql_other=quota_points_bucket; rest_other=quota_points_bucket; graphql_unattributed=quota_points_bucket; min_remaining_graphql=quota_remaining_bucket; min_remaining_rest=quota_remaining_bucket; primary_limit_errors=count_bucket; secondary_limit_errors=count_bucket` | Hourly: this install's GitHub API points per caller in the last hour, the lowest remaining GraphQL and REST budget, and refusals, all bucketed. |
| `github_rate_limited` | `caller=github_caller; kind=rate_limit_kind; own_usage_low=boolean` | GitHub refused a call for a rate limit (at most one per 10 minutes per install). |
| `instance_heartbeat` | `project_count=count_bucket; active_agent_count=count_bucket; dashboard_running=boolean` | At most once per 24 hours: this install is in use, and whether a dashboard sent it. |
| `machine_link_started` | `method=link_method` | This machine started a machine link as the requester. |
| `machine_link_approved` | `method=link_method; side=link_side` | A machine link completed on this machine's side. |
| `machine_link_failed` | `method=link_method; side=link_side; reason=link_failure_reason` | A machine link failed on this machine's side. |
| `phone_paired` | `replaced_previous=boolean` | A phone paired with this machine. |
| `phone_removed` | `by=phone_removed_by` | A phone's pairing with this machine was revoked. |
| `anywhere_channel_opened` | `route=channel_route; ok=boolean; error_class=channel_error_class` | The link supervisor's channel outcome for a linked machine changed (at most one per change per link). |
| `relay_usage_sampled` | `bytes=relay_bytes_bucket` | At most hourly: bytes this machine relayed since the previous sample. |
| `mcp_session_seen` | `mcp_surface=mcp_surface; mcp_protocol=mcp_protocol; mcp_client=mcp_client; mcp_auth=mcp_auth` | At most once per day per surface, client, protocol revision and credential kind: an MCP client opened a session. |
| `mcp_tool_called` | `mcp_surface=mcp_surface; mcp_client=mcp_client; mcp_tool=mcp_tool` | At most once per day per surface, client and tool: an MCP client called an Overdeck tool. |
| `client_request_failed` | `client=telemetry_client; route=client_route; route_area=client_route_area; method=http_method; status=request_status` | A phone or browser request to the machine's API failed (at most one per route, area and status per minute per page load). |
| `phone_link_state` | `state=link_state; reason=link_reason; route=link_route; recover_time=recovery_bucket` | The phone's link to the machine failed, dropped, recovered or changed route. |

| Domain | Allowed values |
| --- | --- |
| `agent_spawn_mode` | `spawn-and-send`, `spawn-work-and-send` |
| `answer_type` | `custom`, `selection`, `note`, `selection+note` |
| `auto_merge_variant` | `segmented`, `badge` |
| `boolean` | `false`, `true` |
| `channel_error_class` | `none`, `unreachable`, `identity_refused`, `unknown_peer`, `unsupported`, `no_relay_plan`, `descriptor_failed`, `wrong_machine`, `heartbeat_failed`, `revoked` |
| `channel_route` | `lan`, `tailnet`, `ssh`, `public`, `direct`, `relay`, `stored` |
| `cli_verb` | `abort`, `approve`, `backlog`, `backup`, `clean`, `context`, `destroy`, `dev`, `diff`, `doctor`, `done`, `down`, `edit`, `finalize`, `fork`, `handoff`, `health`, `init`, `issues`, `kill`, `list`, `migrate`, `mode`, `open`, `pause`, `pending`, `plan`, `project`, `projects`, `recover`, `reload`, `reopen`, `request`, `reset`, `restart`, `restore`, `resume`, `review`, `scope`, `serve`, `show`, `skills`, `spawn-reviewer`, `staffing`, `start`, `status`, `strike`, `sync`, `sync-main`, `tell`, `unarchive-conversation`, `unpause`, `untroubled`, `up`, `update`, `validate`, `wipe`, `write-sequence`, `other` |
| `client_route` | `/api/activity`, `/api/agent-directory`, `/api/agent-requests`, `/api/agents`, `/api/agents/:id/answer-question`, `/api/agents/:id/message`, `/api/agents/:id/permissions/:requestId/respond`, `/api/agents/:id/plan-action`, `/api/agents/:id/tell`, `/api/backend-restart-recovery`, `/api/backend-restart-recovery/dismiss`, `/api/backend-restart-recovery/resume-all`, `/api/connectors/self`, `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/codex-approval`, `/api/conversations/:id/pane-choice`, `/api/conversations/:id/permission`, `/api/conversations/:id/pi-ask-answer`, `/api/conversations/:name/abort`, `/api/conversations/:name/about`, `/api/conversations/:name/attachments/:file`, `/api/conversations/:name/bookmarks`, `/api/conversations/:name/compact`, `/api/conversations/:name/delete-image`, `/api/conversations/:name/diffs`, `/api/conversations/:name/diffs/:turnId`, `/api/conversations/:name/kickoff`, `/api/conversations/:name/message`, `/api/conversations/:name/message-locator`, `/api/conversations/:name/messages`, `/api/conversations/:name/plan-action`, `/api/conversations/:name/preview-ports`, `/api/conversations/:name/pull-requests`, `/api/conversations/:name/pull-requests/sync`, `/api/conversations/:name/release`, `/api/conversations/:name/release/complete`, `/api/conversations/:name/release/transfer/:transferId`, `/api/conversations/:name/release/undo`, `/api/conversations/:name/resume`, `/api/conversations/:name/scheduled-messages`, `/api/conversations/:name/scheduled-messages/:id`, `/api/conversations/:name/schedules`, `/api/conversations/:name/schedules/:id`, `/api/conversations/:name/stop`, `/api/conversations/:name/switch-model`, `/api/conversations/:name/thinking-level`, `/api/conversations/:name/tool-body/:toolUseId`, `/api/conversations/:name/upload-image`, `/api/conversations/pending-input`, `/api/costs/request-digest`, `/api/costs/summary`, `/api/disk-alert`, `/api/explorer/download`, `/api/explorer/edit-workspaces/:workspaceId`, `/api/explorer/edit-workspaces/:workspaceId/discard`, `/api/explorer/edit-workspaces/:workspaceId/merge`, `/api/explorer/edit-workspaces/:workspaceId/pr`, `/api/explorer/upload`, `/api/fleet/conversations`, `/api/fleet/issues/:id/activity`, `/api/fleet/issues/:id/start`, `/api/fleet/machines`, `/api/fleet/needs-you`, `/api/fleet/placement`, `/api/fleet/search`, `/api/fleet/workers`, `/api/fleet/workers/:id/stop`, `/api/flywheel/status`, `/api/github/identities`, `/api/harness-auto-update`, `/api/issues`, `/api/issues/:id`, `/api/issues/resource-allocated`, `/api/lanes`, `/api/lanes/:name`, `/api/lanes/:name/stop`, `/api/machines/conversations`, `/api/machines/heartbeat`, `/api/machines/issue-activity`, `/api/machines/needs-you`, `/api/machines/projects`, `/api/machines/projects/:key/file`, `/api/machines/projects/:key/source`, `/api/machines/self`, `/api/machines/work/conversations`, `/api/machines/work/issues/:id/start`, `/api/machines/work/lanes`, `/api/machines/work/lanes/:name/reap`, `/api/machines/work/lanes/:name/status`, `/api/machines/work/projects`, `/api/machines/work/projects/:jobId`, `/api/machines/work/workers`, `/api/needs-you`, `/api/palette/search`, `/api/phones/self`, `/api/phones/self/notification-preferences`, `/api/phones/self/push-key`, `/api/pipeline/membership`, `/api/pull-requests`, `/api/pull-requests/conversations`, `/api/push/history`, `/api/registered-projects`, `/api/self/done`, `/api/self/handoff`, `/api/self/jobs/:id`, `/api/self/jobs/:id/wait`, `/api/self/lanes`, `/api/self/lanes/report`, `/api/self/lanes/wait`, `/api/self/machine-link-requests`, `/api/self/machine-link-requests/:id/wait`, `/api/self/memory/facts`, `/api/self/memory/search`, `/api/self/pull-request-watches`, `/api/self/pull-request-watches/:id`, `/api/self/pull-requests`, `/api/self/secret-requests`, `/api/self/secret-requests/:id/wait`, `/api/self/tasks/block`, `/api/self/tasks/claim`, `/api/self/tasks/done`, `/api/self/worker-report`, `/api/self/workers`, `/api/self/workers/:id`, `/api/self/workers/:id/wait`, `/api/settings/resolved`, `/api/telemetry/client-config`, `/api/versions/self`, `/api/versions/self/update`, `/api/workers`, `/api/workers/:id/status`, `/api/workers/:id/stop`, `/events/stream`, `/events/version`, `other` |
| `client_route_area` | `access-tokens`, `account`, `activity`, `admin`, `agent-directory`, `agent-requests`, `agents`, `anywhere`, `artifacts`, `autopreso`, `backend-restart-recovery`, `backlog`, `boot-reconciliation`, `cache`, `cache-status`, `claude-code`, `cliproxy`, `cloister`, `color-themes`, `command-deck`, `commands`, `confirmations`, `connectors`, `context`, `conversations`, `costs`, `dashboard`, `deacon`, `deft`, `deploy`, `dev`, `devices`, `diffs`, `directory`, `discovered-sessions`, `disk-alert`, `effort`, `environment`, `events`, `explorer`, `fleet`, `flywheel`, `fs`, `git-activity`, `github`, `github-quota`, `godview`, `harness-auto-update`, `health`, `hooks`, `internal`, `issues`, `jev`, `joins`, `knowledge-viewer`, `lanes`, `linear-mcp-auth`, `linked-conversations`, `machines`, `mcp`, `mcp-oauth`, `memory`, `merge-queue`, `merge-train`, `metrics`, `model-presets`, `models`, `needs-you`, `no-resume-mode`, `orders`, `pairing`, `palette`, `parked`, `phones`, `pipeline`, `planning`, `prereqs`, `project-mappings`, `projects`, `pull-requests`, `push`, `rally`, `registered-projects`, `registry`, `remote`, `resources`, `restart-gate`, `resume-all`, `review`, `self`, `session-trees`, `settings`, `shadow`, `share-probe`, `shares`, `show`, `skills`, `specialists`, `system`, `tailscale`, `telemetry`, `terminals`, `tiered`, `tracker-status`, `trackers`, `triggers`, `tts`, `update`, `vault`, `velocity`, `version`, `versions`, `voice`, `webhooks`, `workers`, `workspace-registry`, `workspace-stack-health`, `workspaces`, `other` |
| `close_out_variant` | `card`, `inspector` |
| `count_bucket` | `0`, `1-2`, `3-5`, `6-10`, `11+` |
| `dashboard_tab` | `home`, `pipeline`, `kanban`, `command-deck`, `agents`, `flywheel`, `orders`, `backlog`, `resources`, `knowledge`, `skills`, `context`, `health`, `activity`, `metrics`, `costs`, `autopreso`, `settings`, `god-view`, `deacon`, `sessions`, `awaiting-merge`, `workspace-new`, `project-new`, `workspace` |
| `decision_subject` | `agent`, `conversation` |
| `duration_bucket` | `under_100ms`, `100ms-999ms`, `1s-9s`, `10s+` |
| `forge` | `github`, `gitlab` |
| `fork_kind` | `summary`, `handoff`, `plain` |
| `github_caller` | `pipeline_membership`, `pr_cache`, `pr_sync`, `ci_repair`, `issue_poller`, `close_out`, `tracker_client`, `app_rest`, `quota_sampler`, `agent`, `pr_adoption`, `other` |
| `harness` | `claude-code`, `pi`, `ohmypi`, `codex`, `acp`, `kimi-code`, `opencode`, `muse`, `prime-agent`, `grok` |
| `http_method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `other` |
| `install_kind` | `user`, `remote_vm`, `dev_checkout`, `container` |
| `link_failure_reason` | `bad_pairing_url`, `unreachable`, `pairing_refused`, `unsupported`, `identity_mismatch`, `exchange_failed`, `grant_refused`, `offline`, `approval_refused`, `approval_failed`, `other` |
| `link_method` | `pairing_code`, `ssh`, `fly`, `directory_approval`, `other` |
| `link_reason` | `none`, `offline`, `no_path`, `unreachable`, `removed`, `pairing_refused`, `identity_mismatch`, `unsupported`, `channel_failed`, `delayed`, `restarting`, `unauthorized`, `resume`, `other` |
| `link_route` | `direct`, `relay`, `unknown` |
| `link_side` | `requester`, `approver` |
| `link_state` | `failed`, `dropped`, `recovered`, `route_changed` |
| `mcp_auth` | `agent_token`, `oauth`, `access_token`, `connector` |
| `mcp_client` | `claude_code`, `codex`, `cursor`, `vscode`, `chatgpt`, `grok`, `hermes`, `openclaw`, `gemini`, `opencode`, `kimi`, `overdeck_connector`, `other` |
| `mcp_protocol` | `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`, `other` |
| `mcp_surface` | `dashboard_http`, `public_http`, `stdio`, `connector_http`, `connector_stdio` |
| `mcp_tool` | `answer_agent_permission`, `answer_agent_plan`, `answer_codex_approval`, `answer_pane_choice`, `answer_permission`, `answer_pi_ask`, `answer_plan`, `answer_question`, `delegate_task`, `delete_scheduled`, `done`, `handoff`, `interrupt_conversation`, `lane_report`, `lane_start`, `lane_status`, `lane_stop`, `lane_wait`, `link_machine`, `link_machine_wait`, `link_pull_request`, `list_conversations`, `list_machines`, `list_pending_input`, `list_pull_request_watches`, `list_scheduled`, `list_workers`, `memory_add`, `memory_search`, `read_conversation`, `request_secret`, `resume_conversation`, `schedule_message`, `schedule_recurring`, `search_conversations`, `secret_wait`, `send_message`, `start_conversation`, `start_issue`, `start_worker`, `stop_conversation`, `task_block`, `task_cancel`, `task_claim`, `task_done`, `task_status`, `task_wait`, `unwatch_pull_request`, `update_scheduled`, `wait_job`, `watch_pull_request`, `worker_report` |
| `merge_kind` | `pipeline` |
| `model_family` | `claude`, `gpt`, `gemini`, `kimi`, `minimax`, `glm`, `mimo`, `other` |
| `phone_removed_by` | `operator`, `phone` |
| `pipeline_stage` | `work_done`, `review_passed`, `verification_passed`, `merged`, `closed_out` |
| `project_mode` | `clone`, `existing`, `new` |
| `quota_points_bucket` | `0`, `1-49`, `50-199`, `200-499`, `500-999`, `1000-2499`, `2500+` |
| `quota_remaining_bucket` | `0`, `1-99`, `100-499`, `500-999`, `1000-2499`, `2500+`, `unknown` |
| `rate_limit_kind` | `primary`, `secondary` |
| `recovery_bucket` | `none`, `under_1s`, `1s-4s`, `5s-14s`, `15s-59s`, `60s+` |
| `relay_bytes_bucket` | `under_1mb`, `1mb-9mb`, `10mb-99mb`, `100mb-999mb`, `1gb+` |
| `request_status` | `400`, `401`, `403`, `404`, `408`, `409`, `413`, `422`, `429`, `other_4xx`, `500`, `502`, `503`, `504`, `other_5xx`, `network`, `timeout`, `aborted` |
| `telemetry_client` | `phone`, `desktop` |

Raw counts and timings are never sent; GitHub quota points and remaining
values are sent only as the buckets above. Pipeline attribution is emitted only
after the canonical pipeline-membership resolver confirms that the issue is in
the pipeline, so a stale or orphaned agent's on-disk state cannot supply
harness or model metadata for an issue that already left the pipeline.

## Overdeck Anywhere events

The dashboard server on each machine sends the Anywhere events, and only about
its own side of a link, pairing or channel. In a machine link, the requester is
the machine that starts the link: it pastes a pairing link, runs `pan machines
add-ssh`, provisions a Fly machine, or asks for two-screen approval. The
approver is the machine that accepts it. Each machine reports `side` as the
role it played.

- The approver of a pairing-code exchange cannot tell whether the requester
  used a pasted pairing link, SSH or Fly, because all three present an `odp_`
  code. So the approver always reports `method=pairing_code`.
- `anywhere_channel_opened` is sent at most once per change in route, result
  and error class per link. A linked machine that stays offline retries
  indefinitely, but ten failed probes with the same class produce one event.
  A failed probe reports the last probe phase it tried (`stored`, `direct` or
  `relay`); a failure while adopting a channel reports that route's kind.
- `relay_usage_sampled` is sent at most hourly. It carries the bytes this
  machine relayed since the previous sample as a bucket in decimal megabytes.
  Bytes in a window that never sees another relayed byte are not sent.
- A relay refusal because the plan has no relay, or because the monthly
  allowance is used, reports as `unreachable`. The one exception is a direct
  path that failed when the plan has no relay to fall back on: that reports as
  `no_relay_plan`.

No Anywhere event carries a machine label, environment id, token id, URL, key,
client id or raw byte count. Every value comes from a closed domain above, and
the same opt-out covers these events as every other event.

## MCP events

Overdeck's MCP tool module is served on five surfaces, and each event names
the one it came from in `mcp_surface`:

- `dashboard_http`: `POST /mcp` on the dashboard, reached on loopback, LAN or
  tailnet. Managed agents, Copy MCP URL tokens and OAuth sign-ins land here.
- `public_http`: the same route reached through Tailscale Funnel (Public MCP),
  identified by the `Tailscale-Funnel-Request` header.
- `stdio`: `pan mcp serve`.
- `connector_http` and `connector_stdio`: `pan mcp connector serve` in HTTP
  mode and with `--stdio`.

`mcp_session_seen` is sent for a message that identifies a session: an
`initialize` request, or any request whose `params._meta` carries the
2026-07-28 keys `io.modelcontextprotocol/protocolVersion` or
`io.modelcontextprotocol/clientInfo`. A plain `tools/call` that carries only
the `MCP-Protocol-Version` header sends no session event.

`mcp_protocol` is the revision the client asked for, not the one the server
answered: the `initialize` request's `params.protocolVersion`, else the
`_meta` protocol key, else the header. A value outside the domain reads
`other`. The current SDK refuses a 2026-07-28 HTTP request with 400 before any
server code runs, so the HTTP surfaces read the raw body and header before the
SDK transport. A 2026-07-28 request is recorded even though it is refused.

`mcp_client` is the client family, taken from `clientInfo.name` and lower-cased.
The first matching rule wins:

| Name contains | `mcp_client` |
| --- | --- |
| cursor | cursor |
| codex | codex |
| claude-code, claude code | claude_code |
| visual studio code, vscode, vs code | vscode |
| chatgpt, openai | chatgpt |
| grok | grok |
| hermes | hermes |
| openclaw | openclaw |
| gemini | gemini |
| opencode | opencode |
| kimi | kimi |
| overdeck | overdeck_connector |

Any other name, a missing name, or a name over 200 characters reads `other`. A
session message without a name uses the client last seen from the same caller.
The raw client name, version, title and website are never sent.

`mcp_auth` is the credential kind. An OAuth sign-in reads `oauth`, an agent
token reads `agent_token`, and any other token (Copy MCP URL, `pan token
create`) reads `access_token`. Both connector surfaces read `connector`. A
request without a valid credential is refused before it is observed, so it
sends nothing.

Dedupe:

- `mcp_session_seen` is sent at most once per UTC day per surface, client,
  protocol revision and credential kind on each install. Connector surfaces
  are the exception: see the last bullet.
- `mcp_tool_called` is sent at most once per UTC day per surface, client and
  tool, with the same connector exception. It carries no count, no arguments and no result; unknown or hidden tool
  names send nothing.
- Process memory is the first check. The dashboard and `pan mcp serve`
  surfaces also keep the keys sent today in `~/.overdeck/telemetry-mcp-seen.json`,
  because every agent session runs its own `pan mcp serve`. Two processes
  that write at the same moment can send one duplicate.
- Connector surfaces dedupe in memory only and never write that file, so the
  daily limit holds per connector process. A connector that restarts during
  the day can send the same key again.

With telemetry off, no MCP event is sent and `telemetry-mcp-seen.json` is
neither read nor written.

### MCP usage dashboard (PostHog)

Create an "MCP usage" dashboard in PostHog project 514675 once events arrive,
with three insights:

1. **Installs by protocol revision:** trend of `mcp_session_seen`, unique users
   (`distinct_id`), weekly, broken down by `mcp_protocol`, last 90 days.
2. **Installs by client family:** the same trend, broken down by `mcp_client`.
3. **Installs by surface:** the same trend, broken down by `mcp_surface`.

The same question in HogQL:

```sql
SELECT properties.mcp_protocol AS protocol, count(DISTINCT distinct_id) AS installs
FROM events
WHERE event = 'mcp_session_seen' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY protocol
ORDER BY installs DESC
```

## Hosted services

The overdeck.ai account, directory and share Workers (`services/account`,
`services/connect` and `services/share`) send no telemetry to PostHog. They keep
only Cloudflare's own request metrics. The events above already measure the
link, pairing and relay funnel from the machines. Both the account and
directory Workers hold GitHub account ids and device ids by design, so any
event they sent would sit next to an identity. The user docs
(`configuration/telemetry.mdx`) also promise that account ids and GitHub logins
are never sent.

## Client request failures and the phone

[PAN-5100](https://github.com/eltmon/overdeck/issues/5100) adds `client_request_failed`
(both clients) and `phone_link_state` (phone only), so a failed read, a crash,
or a dropped link reaches PostHog instead of only an on-screen error message.

### The request-failure observer

`src/dashboard/frontend/src/lib/requestFailures.ts` wraps `fetch` once, on the
desktop in `main.tsx` and on the phone in `apps/mobile/src/main.tsx` after the
channel shims install (so it sees the shimmed `fetch`). It reports only
same-origin `/api/` and `/events/` requests that resolve with HTTP status
≥ 400 or reject (network error, timeout, or abort); a 2xx response and a
cross-host URL (PostHog itself) are never reported.

`route` is the closed route template (for example `/api/conversations/:id`),
and `route_area` is the first path segment after `/api/` — both from a fixed,
tested list, so an id or an unknown admin path can never leak into an event.
A desktop admin route the phone cannot call still reports `route: other` with
its real `route_area`, which is how a phone 403 on an admin route becomes
diagnostic signal: it reports `client_request_failed` with `status: 403` and
marks a scope gap the phone UI still has (D-20), not noise to filter out.
`status` is the exact 4xx/5xx code when it is one of the common ones, else
`other_4xx` / `other_5xx`, or `network` / `timeout` / `aborted` for a
rejection. At most one `client_request_failed` per (`route`, `route_area`,
`status`) per 60 seconds per page load — a reload starts the throttle again.
Unlike the issue's original ask, the event carries no `query_key_root`: the
fetch wrapper cannot see which React Query call triggered a request, and
`route` already names the endpoint.

### Phone consent

The phone has no telemetry switch of its own. It reads
`GET /api/telemetry/client-config` (scope `read:state`) after the machine
view mounts, and initializes PostHog only when the answer's
`effectiveEnabled` is `true`. It caches the last answer per machine in
`localStorage` under `overdeck.telemetry.<environmentId>` and initializes
from a cached "on" immediately at mount, so a link that is down from the
start is still reported. Turning telemetry off on a machine reaches the
phone only on its next successful connection to that machine, since the
answer travels over the same link telemetry would report on.

### Identity

The phone shares the machine's install id (`bootstrap.distinctID`) and uses
in-memory PostHog persistence, so opening another machine never carries one
machine's id into another's events. The desktop keeps its own anonymous
browser `distinct_id`. Both clients register `client`, `platform`,
`app_version` (phone), `build_commit`, `install_id`, and `install_kind` as
super properties (see "Install kind" above); `operatorHash` follows the same
register/unregister rule as the desktop.

### `phone_link_state`

The phone's link to the open machine reports `state`: `failed` (a dial
failed, at most once per `reason` per 60 seconds), `dropped` (the connection
phase left `live`, `reason` is `resume` within 5 seconds of a foreground
resume, else the new phase name), `recovered` (the phase returned to `live`,
with a bucketed `recover_time`), or `route_changed` (the link's direct/relay
route changed). Only the currently open machine is ever reported, even though
the same connection also opens links to every paired machine for
notification-preference sync.

## Local DB job diagnostics

The dashboard logs slow worker jobs locally as
`[db-jobs] slow: op=<operation> lane=<lane> waitMs=<n> runMs=<n> depth=<n>` when
queue wait or execution exceeds one second. Use the lane, wait time, run time,
and queue depth to distinguish worker congestion from a slow operation. These
raw timings stay in local logs and are not sent as anonymous telemetry.

Node events also receive the anonymous install ID, the install kind, and the
centrally stamped `$process_person_profile: false`, platform, architecture,
Overdeck version, and client type. The frontend registers the same install ID
and install kind and configures PostHog for identified-only person profiles,
so anonymous product events do not create person profiles.

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
- `src/dashboard/frontend/src/lib/requestFailures.ts` is the only door that
  reports a failed `fetch`; it calls `capture()` in the door above rather
  than importing `posthog-js` itself.
- Node product events, exception capture, and flag evaluation use
  `src/lib/telemetry/service.ts`; no other production module imports
  `posthog-node` or sends directly to PostHog.
- `src/lib/telemetry/mcp.ts` is the only MCP telemetry door: every surface
  and the `tools/call` handler record through it.
- `src/lib/telemetry/posthog-read.ts` is the only PostHog read door (the
  `pan doctor github-quota` remote view); it sends the `operatorHash` as a
  HogQL placeholder value, never inside the SQL.
- Event names and property types come from `@overdeck/contracts`.
- The `services/` Workers do not import a PostHog SDK.
- The release workflow is the source-map upload owner because it rebuilds the
  dashboard bundle that is actually published.
