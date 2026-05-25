You are doing a pass-3 deep audit of a closed GitHub issue from `eltmon/panopticon-cli`. The previous two audit passes missed real failures by accepting "proxy" evidence that didn't actually match the AC. Pass-3 methodology is STRICT.

## Rules

1. **ONLY the original issue body text is the source of ACs.** Comments added during work, vBRIEF artifacts, audit notes, and "implementation details added later" do NOT count. If the shipped behavior matches a different interpretation than the original AC text, that's REOPEN, not GOOD.

2. **Proxy evidence is REOPEN.** If the AC says "X" and the evidence is "Y, which we believe demonstrates X", that's REOPEN. Examples:
   - AC: "spawn an agent and measure tokens" — Evidence: "run a CLI command and measure bytes" → REOPEN
   - AC: "Files tab renders entries" — Evidence: "stub component says 'coming soon'" → REOPEN
   - AC: "endpoint returns trimmed list" — Evidence: "static constant is trimmed (but endpoint isn't checked)" → REOPEN

3. **Each AC item gets ONE verdict** with reproducible evidence:
   - ✓ VERIFIED — specific evidence (file:line you read, command you ran with output quoted, API response with HTTP status, UI screenshot path)
   - ✗ NOT MET — the shipped behavior does not satisfy this AC
   - ⊘ AMBIGUOUS — needs operator clarification

4. **Default to REOPEN when in doubt.** "Plausibly satisfies" is not enough. "Mostly works" is not enough.

5. **For UI ACs**: use the Playwright MCP tools (`mcp__playwright__browser_navigate`, `_snapshot`, `_take_screenshot`) to verify rendering. The dashboard is at `https://pan.localhost`. Save any screenshots to `/tmp/audit-pass3/screenshots/PAN-{ISSUE_NUM}-<view>.png` so they can be attached to the issue comment.

6. **Tool access**: you have full shell access. Use `gh`, `git`, `curl`, `grep`, `cat`, `pan` CLI commands directly. Working dir: `/home/eltmon/Projects/panopticon-cli`. Main HEAD: `c173152f7`.

## Output format

Your output is a structured markdown comment ready to post to the GitHub issue. Use exactly this template:

```
## Pass-3 deep audit — 2026-05-24

**Verdict**: STAYS-CLOSED | REOPEN | SCOPE-AMEND

### Original AC (verbatim quote from issue body)
[paste the AC list as it appears in the issue body]

### Per-AC verification
1. **<AC text>**
   ✓ / ✗ / ⊘
   *Evidence*: <file:line | command output quoted | API response | UI screenshot path>
2. ...

### UI reproduction (if any UI in the AC)
1. Open https://pan.localhost
2. Click <X>
3. See <Y>
[screenshot: /tmp/audit-pass3/screenshots/PAN-{ISSUE_NUM}-<view>.png]

### Recommendation
- If STAYS-CLOSED: one sentence per AC explaining why it's satisfied
- If REOPEN: specific ACs not met + recommended reopen comment text the operator can paste
- If SCOPE-AMEND: what shipped vs original intent, recommended AC amendment text
```

Be thorough but tight — the output gets posted as a GitHub comment.
