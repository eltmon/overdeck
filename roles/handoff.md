---
name: handoff
description: Panopticon handoff prompt template for live agents to author conversation handoff documents.
---

# Agent-authored handoff request

You have received a one-shot Panopticon handoff request for the current conversation. This is not a new task assignment and it must not block your normal work after the handoff document is complete.

## Focus

{{focus}}

Use the focus above to decide what the successor conversation most needs to know. If the focus is empty or says no specific focus was provided, write a general handoff for continuing the current work.

## Output path

Write the completed Markdown handoff document to:

`{{outputPath}}`

After the document write has fully completed, create a sibling sentinel file at:

`{{outputPath}}.done`

Do not create the `.done` sentinel before the handoff document is complete. Panopticon treats the sentinel as the completion signal.

## Required document contract

Write a concise Markdown document that helps a successor conversation continue from here without replaying the full transcript. Include enough context to act, but avoid copying large source materials into the document.

The document must include these H2 sections:

- `## Current objective`
- `## What has been done`
- `## Decisions and rationale`
- `## Open work`
- `## Suggested skills`
- `## Artifacts and references`
- `## Completion behavior`

The `## Suggested skills` section is required. List any Claude Code slash skills, Panopticon skills, repo-specific commands, or workflow helpers the successor should consider using, with a short reason for each suggestion.

In `## Artifacts and references`, reference PRDs, plans, ADRs, issues, commits, diffs, logs, screenshots, and other artifacts by path, commit hash, issue URL, or other stable pointer. Do not duplicate PRD, plan, ADR, issue, commit, or diff content verbatim. Summarize the relevance in one sentence and point to the source.

In `## Completion behavior`, state the submission rule for the successor: if this handoff enters a Panopticon feature workspace (`workspaces/feature-*`) and the successor completes real work that results in pushed commits, the successor must submit the work rather than stopping at "done". For Panopticon-tracked issues, run `pan done <ISSUE_ID>` (or invoke `/rebase-and-submit` if addressing review feedback); for untracked branches, open a pull request with `gh pr create`. If this handoff is not entering a feature workspace, write "N/A — not a feature workspace".

## Redaction requirements

Redact secrets and sensitive data before writing the handoff. Do not include API keys, passwords, session tokens, private keys, credential files, personal access tokens, OAuth tokens, cookies, or PII. If a secret or PII influenced the work, describe it generically, for example `[REDACTED API key]` or `[REDACTED user email]`.

## Completion behavior

1. Write the Markdown handoff document to `{{outputPath}}`.
2. Only after the document write completes, create `{{outputPath}}.done`.
3. Resume your previous normal work. Do not wait for confirmation, do not ask the user about this handoff, and do not stop the current task because of this request.
