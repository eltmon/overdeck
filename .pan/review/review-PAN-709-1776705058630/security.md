# Security Review — PAN-709

## Summary
- Files reviewed: 10 (synthesis.ts, issue-filer.ts, retro-archiver.ts, retro-inputs.ts, retro-writer.ts, skill-lint.ts, flywheel-report.ts, synthesis-commit.ts, scripts/notification-hook, scripts/pre-tool-hook)
- Critical: 1, High: 1, Medium: 2, Low: 2

---

## Critical

### 1. [scripts/pre-tool-hook:108] JSON injection / broken JSON body in heartbeat curl call

**File:** `scripts/pre-tool-hook:108`

**Issue:** The heartbeat curl POST body is constructed with raw shell variable interpolation inside double-quoted JSON, with no escaping:

```bash
-d "{"state":"$AGENT_STATE","tool":"$TOOL_NAME","timestamp":"$(date -Iseconds)"}"
```

`$TOOL_NAME` comes from jq output (line 41) which is reasonably controlled, but the outer shell quoting is wrong — the `{` and `}` are unquoted, so bash expands `{"state":...}` as a brace expression, not a string. More critically, if `$TOOL_NAME` ever contains `"` or `\`, the JSON is malformed or injected. If the dashboard server is running under a permissive JSON parser, a crafted tool name could inject arbitrary JSON fields.

**Risk:** Malformed requests to the local dashboard API; unlikely to be exploited externally since the endpoint is localhost-only, but it represents a latent injection vector if the tool name is ever sourced from a less-trusted channel. The dashboard heartbeat endpoint may also log or process `tool` fields in ways that propagate the injected value.

**Recommended fix:** Use `jq -n` to build the JSON body safely:

```bash
BODY=$(jq -n --arg state "$AGENT_STATE" --arg tool "$TOOL_NAME" --arg ts "$(date -Iseconds)" \
  '{state: $state, tool: $tool, timestamp: $ts}')
curl -s -X POST "http://localhost:3011/api/agents/$AGENT_ID/heartbeat" \
  -H "Content-Type: application/json" \
  -d "$BODY" > /dev/null 2>&1 &
```

---

## High

### 2. [src/lib/flywheel/retro-writer.ts:191] Path traversal in retro file write

**File:** `src/lib/flywheel/retro-writer.ts:191`

**Issue:** `buildRetroFilePath` constructs the output path by joining `retrosDir` with `${issueId.toLowerCase()}-${ts}.md`. No validation is performed on `issueId` before it is used in the path. A crafted `issueId` containing `../` (e.g., `../../etc/cron.d/evil`) would resolve via `path.join` to a path outside the retros directory.

```typescript
export function buildRetroFilePath(issueId: string, ts: number = Date.now(), retrosDir: string = RETROS_DIR): string {
  return join(retrosDir, `${issueId.toLowerCase()}-${ts}.md`);
}
```

`path.join` normalizes `..` traversals, so `join('/home/user/docs/flywheel/retros', '../../etc/cron.d/evil-1234.md')` resolves to `/home/user/docs/etc/cron.d/evil-1234.md`. The `mkdir({ recursive: true })` call in `writeRetro` will create the intermediate directories, amplifying the write-anywhere impact.

**Risk:** If `issueId` is controlled by an external agent or comes from untrusted input, an attacker can write arbitrary `.md`-suffixed files anywhere on the filesystem writable by the process. Severity is moderated by the `.md` suffix constraint and the schema validation gate (the content must pass `validateRetro` first), but the path is still arbitrary.

**Recommended fix:** Validate `issueId` against a strict allowlist pattern before using it in paths:

```typescript
const SAFE_ISSUE_ID = /^[a-z0-9]+-\d+$/;
if (!SAFE_ISSUE_ID.test(issueId.toLowerCase())) {
  throw new Error(`Invalid issueId for file path: ${issueId}`);
}
```

---

## Medium

### 3. [src/lib/flywheel/retro-archiver.ts:103-108] Unsanitized external paths passed to rename/writeFile

**File:** `src/lib/flywheel/retro-archiver.ts:103-108`

**Issue:** `archiveProcessedRetros` receives `processedRetroPaths` as an array of absolute paths supplied by the caller. These paths are used directly in `fsPromises.rename(retroPath, destPath)` without verifying they are inside `retrosDir`. A caller supplying paths outside the retros directory (e.g., `~/.panopticon/agents/.../state.json`) could cause those files to be moved into the archive directory, effectively deleting them from their original location.

**Risk:** Accidental or malicious path confusion could destroy agent state files or other filesystem artifacts. This is an internal API, so exploitation requires a bug in the calling code, not direct external access.

**Recommended fix:** Add a guard to reject any path not under `retrosDir`:

```typescript
for (const retroPath of processedRetroPaths) {
  if (!retroPath.startsWith(retrosDir + '/')) {
    errors.push(retroPath);
    continue;
  }
  // ... proceed with rename
}
```

### 4. [src/lib/flywheel/issue-filer.ts:91-138] Agent-controlled content written verbatim into GitHub issue body

**File:** `src/lib/flywheel/issue-filer.ts:91-138`

**Issue:** `formatIssueBody` embeds `proposal.aggregatedChange` and `proposal.signature.targetSkill` / `proposal.signature.gapDescription` directly into the issue body (inside a fenced code block). These values originate from retro markdown files, which are written by the retro-agent — an LLM. If the retro content contains GitHub Markdown that breaks out of the fenced block (e.g., a line starting with ` ``` ` on its own), the injected content renders as unsanitized Markdown in the GitHub issue UI.

**Risk:** Markdown injection into GitHub issue bodies. Impact is limited to visual confusion, broken issue formatting, and potential phishing-style content if someone crafts a retro to contain misleading Markdown. GitHub does not execute scripts from issue bodies, so XSS is not a concern here.

**Recommended fix:** Escape backtick sequences in the aggregated change text before embedding in a fenced block, or use a non-code-block container for the YAML patch.

---

## Low

### 5. [src/lib/flywheel/retro-writer.ts:114-178] Custom YAML parser — no recursion/bomb protection

**File:** `src/lib/flywheel/retro-writer.ts:114-178`

**Issue:** `parseRetroMarkdown` implements a hand-rolled YAML parser. While simple, it reads the entire file into memory and iterates all lines. There is no limit on file size or list depth. A retro file with millions of list items would consume unbounded memory before validation rejects it.

**Risk:** Local DoS against the synthesis process if a malicious or corrupt retro file is placed in the retros directory. Not remotely exploitable, but worth noting for robustness.

**Recommended fix:** Add a file size check in `writeRetro` before parsing (e.g., reject files > 1 MB).

### 6. [src/lib/flywheel/retro-inputs.ts:147] `gh pr view` branch name from issueId — no shell injection risk (execFile used), but branch name not validated

**File:** `src/lib/flywheel/retro-inputs.ts:147`

**Issue:** The branch name `feature/${issueId.toLowerCase()}` is passed as a positional argument to `execFileAsync('gh', [...])`. Because `execFile` is used (not `exec` with a shell string), there is no shell injection risk. However, `issueId` is not validated against a safe pattern, so an `issueId` like `../something` would be passed as a literal argument to `gh`, which `gh` would reject gracefully. No actual vulnerability, but the lack of input validation is a pattern risk.

**Risk:** Negligible — `execFile` prevents shell injection. Noted for defense-in-depth.

**Recommended fix:** Apply the same `SAFE_ISSUE_ID` pattern validation recommended in finding #2.

---

## Notes

- `synthesis-commit.ts` uses `execFileAsync('git', [...])` throughout with no string interpolation — clean.
- `notification-hook` uses `jq --arg` for all variable interpolation into JSON — clean, except for the `AGENT_ID` used in the curl URL (line 106 equivalent; agent ID comes from tmux session name which is system-controlled).
- `skill-lint.ts` uses `readFileSync` (sync) and `readdirSync` — acceptable per CLAUDE.md since it's CLI-only code, not dashboard server code.
- `flywheel-report.ts` is pure string building with no shell calls or file paths derived from user input — clean.
- No hardcoded secrets, API keys, or credentials found in any reviewed file.
- No SSRF vectors found — all network calls are to `localhost:3011` (pre-tool-hook) or use the `gh`/`git` CLI with execFile.

---

## Verdict

**PASS-WITH-CONCERNS**

The critical finding (JSON injection in pre-tool-hook heartbeat body) affects only the localhost dashboard API and is not remotely exploitable, but it should be fixed before deployment as it produces malformed JSON today. The path traversal in `buildRetroFilePath` is the most structurally significant issue — a simple issueId allowlist check closes it completely. The remaining findings are low-impact internal concerns. No secrets exposure, no remote injection vectors, no unsafe deserialization of external data.
