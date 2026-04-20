# Security Review - PAN-709

## Summary

Found **0 critical vulnerabilities**, **2 warnings**, **1 best-practice note**.

The PR is largely documentation + skill/frontmatter changes, plus a new self-improving-flywheel subsystem (retro-agent, synthesis, issue-filer, skill-lint). External-process execution consistently uses `execFile` with argv arrays (no shell interpolation). Tmux send-keys already uses the safe `load-buffer`/`paste-buffer` pattern; scope fix to per-call counters does not introduce injection surface. GitHub issue filing goes through the existing tracker client. No secrets, no auth surface changes, no new network listeners.

## Critical Vulnerabilities

None.

## Security Warnings

### 1. [scripts/pre-tool-hook:108] Shell-quoting regression in curl JSON body produces malformed request and allows `TOOL_NAME` to influence payload structure

**Severity:** Warning
**OWASP Category:** A03:2021 — Injection (JSON/body injection, local scope)
**Location:** `scripts/pre-tool-hook:108`

**Issue:**
The diff removed the backslash escaping on the inner JSON double-quotes:

```bash
# Before (correct)
-d "{\"state\":\"active\",\"tool\":\"$TOOL_NAME\",\"timestamp\":\"$(date -Iseconds)\"}"

# After (broken)
-d "{"state":"$AGENT_STATE","tool":"$TOOL_NAME","timestamp":"$(date -Iseconds)"}"
```

Under bash quoting rules the second form tokenizes as alternating quoted / unquoted segments, so the literal `"` characters are consumed as shell string delimiters and the resulting payload is `{state:active,tool:Bash,timestamp:...}` — invalid JSON. Additionally, `$TOOL_NAME` is expanded inside a shell-quoted segment with no JSON-escaping: a tool name containing `"` or `\` would further corrupt the body and could inject arbitrary JSON fields into the heartbeat request.

Tool name values originate from Claude Code's pre-tool event and are not under a remote attacker's control, and the endpoint is `localhost:3011`, so real-world impact is limited to the local dashboard. The concern is (a) the heartbeat endpoint will now always 400 (functional regression), and (b) if a future tool name legitimately contains quotes, the body could become attacker-shaped JSON.

**Fix:**
Restore backslash-escaped quotes and pass the tool name through `jq` to produce properly-escaped JSON:

```bash
BODY=$(jq -n \
  --arg state "$AGENT_STATE" \
  --arg tool "$TOOL_NAME" \
  --arg ts "$(date -Iseconds)" \
  '{state:$state, tool:$tool, timestamp:$ts}')
curl -s -X POST "http://localhost:3011/api/agents/$AGENT_ID/heartbeat" \
  -H "Content-Type: application/json" \
  -d "$BODY" > /dev/null 2>&1 &
```

### 2. [src/lib/flywheel/issue-filer.ts:24] Provenance index written to `~/docs/flywheel/` instead of repo/XDG state dir

**Severity:** Warning (data integrity / least-surprise)
**OWASP Category:** A05:2021 — Security Misconfiguration
**Location:** `src/lib/flywheel/issue-filer.ts:24`

**Issue:**
```typescript
export const PROVENANCE_INDEX_PATH = join(homedir(), 'docs', 'flywheel', 'provenance-index.json');
```

`homedir()` joined with literal `docs/` produces `~/docs/flywheel/provenance-index.json`, which is not an XDG location and not the repo's `docs/` directory. If this was intended to live inside the repo (matching `docs/flywheel/retros/` used elsewhere) the path is wrong; if it was intended to be user state it should use `~/.panopticon/` (where all other agent state lives per CLAUDE.md). The current path pollutes the user's home directory and the file — which contains GitHub issue numbers and retro filenames — will be silently orphaned from the repo it describes.

No direct security exploit, but misplaced state files make audit/incident-response harder and can lead to privilege/ownership confusion when multiple users share a host.

**Fix:**
```typescript
export const PROVENANCE_INDEX_PATH = join(homedir(), '.panopticon', 'flywheel', 'provenance-index.json');
```
(or place it inside the repo at `docs/flywheel/provenance-index.json` using the repo root, if that was intended).

## Best Practices

### 1. [scripts/notification-hook:54] Notification log accepts unbounded payload size

**Location:** `scripts/notification-hook:54`
**Recommendation:** `NOTIF_INFO` is read with `cat` from stdin and appended raw (via `--argjson payload`) into `~/.panopticon/logs/notifications.jsonl`. The `tail -n 500` prune bounds line count, but a single very large notification payload could produce a multi-megabyte line and degrade subsequent `tail`/`jq` operations. Consider capping payload size (e.g., truncate to 8 KiB before logging) to bound log growth under pathological input.
**Benefit:** Prevents local log-flood / disk-exhaustion DoS from a misbehaving hook producer.

## Dependency Vulnerabilities

No new third-party runtime dependencies introduced by the diff (bun.lock change is a 2-line churn unrelated to security). No CVE-relevant version bumps.

## Compliance Considerations

None — no PII, auth tokens, or regulated-data handling introduced. GitHub issue bodies formatted by `issue-filer.ts` embed retro filenames and skill names only; all content originates inside the repo.

## Summary Statistics
- Critical: 0
- Warnings: 2
- Best Practices: 1
- Files reviewed (security-relevant subset): scripts/pre-tool-hook, scripts/notification-hook, scripts/heartbeat-hook, src/lib/tmux.ts, src/lib/flywheel/issue-filer.ts, src/lib/flywheel/skill-lint.ts, src/lib/flywheel/synthesis-commit.ts, src/lib/cloister/flywheel-daemon.ts, src/dashboard/server/routes/flywheel.ts
