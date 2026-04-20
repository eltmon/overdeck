# Security Review - 2026-04-20

## Summary

Reviewed PAN-709 self-improving flywheel PR. Most changes are skill markdown and planning docs with no security surface. New executable code lives in `src/lib/flywheel/*`, `src/lib/cloister/retro-agent.ts`, and `scripts/{notification-hook,pre-tool-hook,heartbeat-hook}`.

**Findings:** 0 critical vulnerabilities, 2 warnings, 2 best-practice notes.

## Critical Vulnerabilities

None.

## Security Warnings

### 1. [retro-agent.ts:82-96] Unsanitized `issueId` / `cwd` interpolated into shell scripts

**Severity:** Warning
**OWASP Category:** A03:2021 - Injection (command injection)
**Location:** `src/lib/cloister/retro-agent.ts:82-96` (and the `execAsync` call at ~100)

**Issue:**
`spawnRetroAgent(issueId)` builds `run-retro.sh` and `launcher-retro.sh` via string templates that interpolate `issueId`, `cwd` (from `resolveProjectFromIssue`), and `sessionName` directly into bash:

```ts
await writeFile(innerScript, `#!/bin/bash
cd "${cwd}"
...
export PANOPTICON_ISSUE_ID="${issueId}"
...`);

await execAsync(
  `${buildTmuxCommandString(['new-session', '-d', '-s', sessionName, '-c', cwd])} "bash '${launcherScript}'"`,
);
```

**Risk:**
If `issueId` ever reaches this function with shell metacharacters (backticks, `$(...)`, `"`, newlines), the resulting bash script executes arbitrary commands. Today `issueId` is internal (tracker-provided `PAN-###`), so this is not exploitable — but there is no validation/quoting at this boundary. Any future caller that passes unvalidated input (webhook, API body, dashboard RPC) becomes a command-injection sink.

**Fix:**
Validate `issueId` against `/^[A-Z]+-\d+$/` at entry, and/or pass sensitive values via env (`env -i X=value bash ...`) instead of templating into the script body. Same applies to `cwd` if it can ever come from untrusted sources.

### 2. [notification-hook:53-60] Unbounded notification payload written to shared log

**Severity:** Warning (information disclosure / log growth)
**OWASP Category:** A09:2021 - Security Logging & Monitoring Failures
**Location:** `scripts/notification-hook:53-60`

**Issue:**
The hook writes the full notification JSON payload (`--argjson payload "$NOTIF_INFO"`) to `~/.panopticon/logs/notifications.jsonl`. Notification messages may include prompt content, file paths, or tool arguments. The log is pruned to 500 entries but never rotated for sensitivity, and permissions rely on the user's default umask.

**Risk:**
If notifications ever surface secrets (e.g., the agent is told an API key inline), they are persisted in plaintext indefinitely (for the 500-entry window) on disk. Low severity given this is a single-user local dir, but worth noting for multi-user hosts.

**Fix:**
Either redact known sensitive fields before logging, or chmod 600 the log file explicitly.

## Best Practices

### 1. [issue-filer.ts:151-165] GitHub issue body reflects retro filenames verbatim

**Recommendation:**
`formatIssueBody` embeds `proposal.signature.gapDescription` and retro filenames into Markdown without escaping. GitHub renders Markdown, so a malicious retro filename like `[click me](javascript:...)` could produce phishing links in auto-filed issues. Since retros are authored by a trusted internal agent, the risk is low, but escaping backticks / pipes would harden this against a future retro writer that echoes untrusted external data (e.g., PR comments).

**Benefit:** Defense-in-depth against stored-content injection in auto-filed issues.

### 2. [retro-agent.ts, skill-lint.ts] No timeout / size cap on retro file contents

**Recommendation:**
`gatherRetroInputs` and downstream synthesis read retro files into memory without a max-size guard. A malformed or adversarially large retro (e.g., a runaway agent writing GB of output) could OOM the synthesis process. Cap per-file reads (e.g., 1 MB) and total input size.

**Benefit:** Availability hardening against a misbehaving retro-agent.

## Dependency Vulnerabilities

No new third-party dependencies introduced in the diff (bun.lock delta is internal workspace refs / dev deps only — spot-check did not surface known-CVE packages).

## Compliance Considerations

None specific. No PII, auth, or crypto code touched.

## Summary Statistics

- Critical: 0
- Warnings: 2
- Best Practices: 2
- Files reviewed: ~15 code files (skills markdown excluded from security surface)
