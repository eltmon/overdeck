---
specialist: review-agent
issueId: PAN-830
outcome: changes-requested
timestamp: 2026-04-26T11:25:06Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-830 delivers the Command Deck — a major three-zone UI with reviewer canonical naming, JSONL transcript resolution, liveness primitives, and 10-tab overview. The PR is substantial (65+ files, ~8,600 insertions). Three findings reach the Blocker bar: two command-injection vulnerabilities (RCE vectors on the dashboard server) and one regex ambiguity that silently breaks the reviewer tree for hyphenated project keys. All three must be fixed before merge. The Requirements reviewer's two `!`-prefix findings were correctly self-downgraded to `~` given scope and precedent; they are tracked as high-priority follow-up beads.

## Blockers (MUST fix before merge)

### 1. Command injection — `issueId` into `gh pr list` shell string — `issues.ts:2711` — `!`
**Raised by**: security
**Why it blocks**: `issueId` from the route param is interpolated directly into a double-quoted shell string passed to `execAsync`. An attacker who can hit the dashboard API can achieve remote code execution on the host.

<fix instruction>
Replace `execAsync` shell interpolation with `execFileAsync` (argv array). Validate `issueId` against the expected `PREFIX-NUMBER` format before deriving `branchName`:

```typescript
// Before (vulnerable):
const branchName = `feature/${issueId.toLowerCase()}`;
await execAsync(
  `gh pr list --repo ${prRepoArg} --head "${branchName}" --state all ...`,
)

// After (safe):
if (!/^[A-Za-z]+-\d+$/i.test(issueId)) throw new Error('Invalid issue id');
const branchName = `feature/${issueId.toLowerCase()}`;
await execFileAsync('gh', [
  'pr', 'list',
  '--repo', prRepoArg,
  '--head', branchName,
  '--state', 'all',
  '--json', 'number',
  '--limit', '1',
  '--jq', '.[0].number',
]);
```
</fix instruction>

### 2. Command injection — `issueId`/`issueNum`/`issueLower` into `gh issue/pr` shell strings — `command-deck.ts:947,960,966` — `!`
**Raised by**: security
**Why it blocks**: Three separate `execAsync` calls in the `POST /api/command-deck/planning/:issueId/sync-discussions` route embed route-controlled values (`issueNum`, `issueLower`) into shell strings. A crafted `issueId` achieves RCE on the dashboard host, same vector class as blocker #1.

<fix instruction>
Use `execFileAsync` with explicit argv for all three calls. Also apply the same `issueId` format validation at the route entry:

```typescript
// Validate once at route entry:
if (!/^[A-Za-z]+-\d+$/i.test(issueId)) throw new Error('Invalid issue id');

// Replace all three execAsync calls with execFileAsync:
// gh issue view
await execFileAsync('gh', ['issue', 'view', issueNum, '--repo', repo, '--json', 'comments', '--jq', jq]);
// gh pr list
await execFileAsync('gh', ['pr', 'list', '--repo', repo, '--head', `feature/${issueId.toLowerCase()}`, '--json', 'number,title', '--jq', '.[].number']);
// gh pr view
await execFileAsync('gh', ['pr', 'view', prNum, '--repo', repo, '--json', 'comments', '--jq', '.comments[].body']);
```
</fix instruction>

### 3. Regex ambiguity in `parseReviewerSessionName` — `specialists.ts:721` — `!`
**Raised by**: correctness
**Why it blocks**: The regex uses lazy quantifiers `+?` for both capture groups. For any project key containing hyphens (e.g., `my-project`), the parser returns `null` silently, making all reviewer nodes for that project invisible to the reviewer tree and Command Deck.

<fix instruction>
Anchor the second capture group on the well-known `PREFIX-NUMBER` pattern for issue IDs. Replace the lazy quantifiers with a greedy match for group 1:

```typescript
// Before (vulnerable to misparse):
const m = name.match(/^specialist-([\w.-]+?)-([\w.-]+?)-review-(correctness|security|performance|requirements|synthesis)$/);

// After (anchored on issue ID pattern):
const m = name.match(/^specialist-([\w.-]+)-([A-Za-z]+-\d+)-review-(correctness|security|performance|requirements|synthesis)$/);
```
</fix instruction>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. PrDiffTab renders entire patch as un-memoized, un-virtualized DOM nodes — `PrDiffTab.tsx:424` — `~`
**Raised by**: performance
<fix instruction>
Wrap the diff split + color derivation in `useMemo`. Add virtualization for large diffs (>2000 lines) using `react-virtual` already imported by `MessagesTimeline`:

```tsx
const diffLines = useMemo(() => {
  if (!data?.diff) return [];
  return data.diff.split('\n').map((line) => ({
    line: line || '\u00A0',
    color: diffLineColor(line),
  }));
}, [data?.diff]);

const VIRTUALIZE_THRESHOLD = 2000;
const shouldVirtualize = diffLines.length > VIRTUALIZE_THRESHOLD;
```
</fix instruction>

### 2. MessagesTimeline re-derives sorted timeline + grouped rows on every render — `MessagesTimeline.tsx:106-107` — `~`
**Raised by**: performance
<fix instruction>
Wrap both derivation calls in `useMemo`:

```tsx
const timelineEntries = useMemo(
  () => deriveTimelineEntries(messages, workLog),
  [messages, workLog],
);
const rows = useMemo(
  () => deriveMessagesTimelineRows(timelineEntries, streaming),
  [timelineEntries, streaming],
);
```
</fix instruction>

## Nits (advisory — safe to defer)

- `command-deck.ts:291` — `?` — `isNaN` used where `Number.isFinite` is safer. Replace `isNaN(ms)` with `Number.isFinite(ms)` for consistency with `reviewer-tree.ts:217` and `review-agent.ts:1003`. (correctness)
- `review-agent.ts:1016-1023` — `?` — Race condition in round-N numbering. Round number derived from file count could collide under concurrent writes. Use max existing N + 1 or `Date.now()`. (correctness)
- `reviewer-tree.ts:214-218` — `?` — Duration calculation can produce negative values if clocks are skewed. Clamp to `Math.max(0, ...)`. (correctness)
- `issues.ts:2731-2830` — `?` — Three `Promise.all` pushes into shared `collectedItems` array. Return local arrays and spread after `await Promise.all`. (correctness)
- `OverviewTab.tsx:36-42` — `?` — `REVIEWER_ROLES` duplicated in three places (`OverviewTab.tsx`, `specialists.ts`, `RoleBadge.tsx`). Consider a shared frontend constants file. (correctness)
- `command-deck.ts` — `?` — `gh pr diff` shell-out has 16MB `maxBuffer` but no response size limit enforced. Consider truncating or streaming for very large PRs. (performance)
- `issues.ts:2515-2547` — `?` — `fetchIssuePullRequest` runs 3 sequential `gh` calls; view+diff could run in `Promise.all` after resolving PR number. (performance)
- `issues.ts:2615-2678` — `?` — `fetchIssueDiscussions` sources #1+#2 (Linear + gh issue comments) run sequentially before the parallel block. Could fan out with `Promise.all`. (performance)
- `command-deck.ts` — `?` — Activity endpoint polled every 5s does many FS+tmux reads per call. A 2-second in-process cache keyed by mtime would cut idle reads ~90%. (performance)
- `issues.ts:2655,2737,2767,2800` — `?` — GitHub API calls hard-code `per_page=100` with no pagination. Silent truncation for >100 comments. (performance)
- `reviewer-tree.ts` — `?` — `buildReviewerNodes` fans out per-role round artifact reads. An LRU cache keyed by `(reviewerId, latestRoundN)` would reduce file I/O on consecutive polls. (performance)

## Cross-cutting groups

**Command injection — fix together**: Both security blockers stem from interpolating unvalidated route params into `execAsync` shell strings. The fix pattern is identical: validate input format, replace `execAsync(str)` with `execFileAsync(cmd, [args])`.
- [blocker-1] `issues.ts:2711` — `issueId` in `gh pr list`
- [blocker-2] `command-deck.ts:947,960,966` — `issueId` in `gh issue/pr`

**Frontend re-render loop — PrDiffTab + MessagesTimeline**: Both performance warnings share the same root cause — expensive pure derivations running on every render without `useMemo`. Fix both to establish the pattern for the new Command Deck components.
- [high-1] `PrDiffTab.tsx:424` — un-memoized diff split
- [high-2] `MessagesTimeline.tsx:106-107` — un-memoized timeline derivation

## What's good
- Reviewer canonical naming is correctly implemented and tested; the round-trip `getReviewerSessionName` / `parseReviewerSessionName` pair is sound for non-hyphenated keys
- JSONL resolver with 3-tier fallback is well-tested with thorough unit coverage
- The three-zone `IssueWorkbench` shell with 10-tab overview and liveness primitives is a substantial, cohesive feature
- Security review correctly identified the `javascript:` link sanitization in `ChatMarkdown.tsx` as already present — good defensive practice
- The PR ships 6 well-tested liveness primitives (StatusDot, LiveCounter, RoleBadge, RoundCard, ToolFlash, ActivitySparkline) with 521 lines of test coverage
- `prefers-reduced-motion` accessibility support is correctly implemented in CSS

## Review stats
- Blockers: 3   High: 2   Medium: 0   Nits: 11
- By reviewer: correctness=1, security=2, performance=2, requirements=0
- Files touched: 65+   Files with findings: 14

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-830 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

