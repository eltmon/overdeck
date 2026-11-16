---
name: semgrep
description: >
  Topical: triage Semgrep findings from Overdeck's post-edit hook or the
  semgrep MCP tools, suppress false positives with a justified nosemgrep,
  write and test custom rules with semgrep --test.
triggers:
  - semgrep
  - nosemgrep
  - SAST finding
  - Semgrep found
---

# Semgrep

## Is Semgrep on here?

Check that `"${OVERDECK_HOME:-$HOME/.overdeck}/bin/semgrep"` exists. If it does not, stop:
Semgrep support is off on this machine (`security.semgrep.enabled`), and only the operator
turns it on.

## Running the CLI

`~/.overdeck/bin` is not on `PATH`. Define and use a wrapper instead of calling `semgrep` bare:

```bash
SG="${OVERDECK_HOME:-$HOME/.overdeck}/bin/semgrep"
sg() { env -u SEMGREP_APP_TOKEN -u SEMGREP_RULES SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SEND_METRICS=off \
  SEMGREP_SETTINGS_FILE="${OVERDECK_HOME:-$HOME/.overdeck}/tools/semgrep/settings.yml" \
  SEMGREP_LOG_FILE="${OVERDECK_HOME:-$HOME/.overdeck}/tools/semgrep/semgrep.log" "$SG" "$@"; }
sg scan --config p/default --json --quiet --metrics=off <files>
```

Never `--config auto` — it needs metrics, which Overdeck disables. Scan the files you changed,
not the whole repo.

## Triage a finding

Read the rule id, the line and the message, then decide true or false positive by reading the
data flow, not the rule name. A true positive: fix the code, then rescan the file.

## Suppressing a false positive

Only on the exact line, only naming the rule:

```
# nosemgrep: <rule-id> -- <one-line reason>
```

(use the file's own comment syntax). Never a bare `nosemgrep`, and never a file-level or
`.semgrepignore` exclusion to make a finding go away — reviewers and the `sast` gate treat
unjustified suppressions as defects.

## Custom rules

Put project rules in `.semgrep.yml` or `.semgrep/` at the repo root; the post-edit hook loads
both. Write a test file next to the rule with `# ruleid: <id>` above lines that must match and
`# ok: <id>` above lines that must not, then run `sg --test <rules dir>`. It must pass before you
commit the rule.

## MCP tools

When the operator has enabled `security.semgrep.mcp`, work agents and the review security lane
get these `semgrep` MCP tools:

- `semgrep_scan_with_custom_rule` — try a rule against code before writing it to disk.
- `semgrep_rule_schema` — the YAML schema for a Semgrep rule.
- `get_abstract_syntax_tree` — see how Semgrep parses a snippet.
- `get_supported_languages` — the languages Semgrep can scan.

`semgrep_scan` is intentionally absent (it needs `--config auto`, which this setup never runs);
use the CLI above instead.

## Hook findings

A message starting `Semgrep found` after an edit comes from the post-edit hook. Handle it with
the Triage and Suppressing sections above before moving on.
