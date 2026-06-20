# Issue Pane — Data Inventory

**Iteration 1 — organized by where each datum lives in *today's* UI.**

This is a health-check enumeration of **every** piece of data the issue pane can
display today: the header you see the moment you click an issue, the left issue
tree, and every one of the 15 tabs in the tab menu. Each field carries a **type**
and an **example value**. A later iteration will re-organize the same data by the
*proposed* redesign (cockpit) so we can prove no datum is lost.

**Type vocabulary used below**

| Type | Meaning |
|---|---|
| `String` | free text |
| `Markdown` | multi-line rich text rendered as markdown |
| `Enum(a\|b\|c)` | one of a fixed set |
| `Boolean` | true / false |
| `Integer` | whole number |
| `Number` | decimal |
| `Currency (USD)` | money, 2 decimals, tabular numerals |
| `Tokens` | integer token count |
| `Timestamp` | ISO 8601 datetime string |
| `Duration (s)` | seconds (integer, may be null while running) |
| `Percent` | 0–100 |
| `URL` | absolute http(s) link |
| `Git ref` / `SHA` | branch name or commit hash |
| `Array<T>` / `Map<k,v>` | collection |

**Where the data comes from (endpoints → hooks)**

| Endpoint | Hook | Powers |
|---|---|---|
| `/api/issues/resource-allocated`, `/api/session-trees` | (cockpit feature fetch) | Header identity, issue tree, sessions, resources |
| `/api/review/:id/status` | `useReviewStatusQuery` | Phase, gates, review/test/verification/merge, **History** |
| `/api/issues/:id/check-runs` | `useIssueCheckRunsQuery` | CI summary + check runs |
| `/api/issues/:id/pr` | `usePrQuery` | Pull request facts |
| `/api/issues/:id/pr/details` | `usePrDiffQuery` | Unified diff |
| `/api/issues/:id/costs` | `useIssueCostsQuery` | Costs (by stage / by model) |
| `/api/command-deck/activity/:id` | `useActivityQuery` | Activity feed, agent sessions |
| `/api/command-deck/planning/:id` | `usePlanningQuery` | PRD / STATE / inference, plan summary |
| `/api/workspaces/:id/plan` | (vBRIEF/beads) | vBRIEF document |
| `/api/issues/:id/beads` | (beads) | Beads tasks |
| `/api/issues/:id/discussions` | `useDiscussionsQuery` | Discussion comments |
| `/api/workspaces/:id` | `useWorkspaceQuery` | Workspace, containers, git, services |
| `/api/workspaces/:id/artifacts` | (artifacts) | Published artifacts |
| `/api/agents/:id/git-info`, JSONL transcripts | conversation panel | Conversation messages + tool calls |

---

## 1. Issue Header (always visible when an issue is open)

Source: `ProjectFeature` (`ProjectNode.tsx:48`), `ReviewStatusData`, `IssueCheckRunsResponse`, `PullRequestData`, `IssueCostData`.

### 1.1 Identity & breadcrumb

| Field | Type | Example |
|---|---|---|
| `projectName` | `String` | `panopticon-cli` |
| `issueId` | `String` (mono) | `PAN-1866` |
| `title` | `String` | `Backlog Sequencer — AI-ranked whole-backlog DAG with a reproducible markdown source of truth` |
| `stateLabel` | `String` (canonical) | `in_progress`, `reviewing_on_main`, `verifying_on_main` |
| `status` | `String` (tracker) | `In Progress`, `In Review`, `Blocked` |
| `isShadow` | `Boolean` | `false` |
| `isRally` | `Boolean` | `false` |
| `childCount` / `completedCount` / `inProgressCount` | `Integer` | `28` / `19` / `1` (epics only) |

### 1.2 Phase pill (derived)

| Field | Type | Example | Derivation |
|---|---|---|---|
| phase | `Enum(pending\|reviewing\|testing\|verifying\|queued\|merging\|merged\|blocked\|failed\|ready)` | `blocked` | `phaseStatus(reviewStatus)` |

### 1.3 Header stats

| Field | Type | Example |
|---|---|---|
| `branch` | `Git ref` | `feature/pan-1866` |
| PR number | `Integer` | `1975` |
| CI summary | `String` (derived) | `4/5 ✓` (from check-runs summary) |
| `cost` (resolvedTotalCost) | `Currency (USD)` | `$67.72` |

### 1.4 Pipeline progress bar — 7 phases (`computePipelineStates`)

Each phase has a state `Enum(done\|active\|fail\|todo)`:

| Phase | Source signal | Example state |
|---|---|---|
| Plan | `hasPlan` | `done` |
| Work | work session `status` | `active` (running) |
| Review | `reviewStatus` | `fail` (blocked) |
| Test | `testStatus` | `todo` (pending) |
| CI/CD | check-runs `summary` | `fail` (4/5) |
| Ship | `mergeStatus` | `todo` |
| Merge | `mergeStatus` / `readyForMerge` | `todo` |

### 1.5 Gates row (`computeGates`)

Each gate: `{ label, value, tone: Enum(ok\|bad\|run\|wait) }`.

| Gate | Type | Example value | Example tone |
|---|---|---|---|
| Review | `Enum` | `blocked` | `bad` |
| Test | `Enum` | `pending` | `wait` |
| Verification | `Enum` | `pending` | `wait` |
| CI | `String "passed/total"` | `4/5` | `bad` |
| PR | `Enum(mergeable\|conflicting\|unknown\|no PR)` | `mergeable` | `ok` |
| Merge-ready | `Boolean→yes/no` | `no` | `bad` |

### 1.6 Merge CTA + Actions

| Field | Type | Example |
|---|---|---|
| Merge button state | `Enum(merged\|ready\|gated)` | `gated` → "Merge — blocked by review" |
| merge block reason | `String` (derived) | `blocked by review` |
| Actions menu | `Array<Action>` grouped | `Plan`, `Start agent`, `Review & test`, `Tell agent`, `Pause`, `Wipe`, … (groups: planning/work/review/agent/workspace/artifacts/navigation/danger/preserved) |

---

## 2. Issue Tree / Sessions (left rail today)

### 2.1 SessionNode (`@overdeck/contracts` types.ts:544)

| Field | Type | Example |
|---|---|---|
| `type` | `Enum(planning\|work\|strike\|review\|reviewer\|test\|ship\|merge\|legacy)` | `work` |
| `role` | `String` (reviewer role) | `requirements` |
| `sessionId` | `String` | `pan-1866-work` |
| `tmuxSession` | `String` | `agent-pan-1866-work` |
| `model` | `String` | `claude-sonnet-4-6` |
| `harness` | `Enum(claude-code\|pi\|codex)` | `claude-code` |
| `startedAt` | `Timestamp` | `2026-06-20T14:30:00Z` |
| `endedAt` | `Timestamp?` | `2026-06-20T15:02:00Z` |
| `duration` | `Duration (s)` (null while running) | `1234` |
| `status` | `Enum(starting\|running\|stopped\|error\|unknown)` | `running` |
| `presence` | `Enum(active\|idle\|suspended\|ended)` | `active` |
| `hasJsonl` | `Boolean` | `true` |
| `awaitingInput` | `Boolean` | `false` |
| `awaitingInputPrompt` | `String?` | `Approve plan? (y/n)` |
| `awaitingInputReason` | `String?` | `plan_approval` |
| `deliveryMethod` | `Enum(auto\|channels\|tmux)` | `auto` |
| `paused` | `Boolean` | `false` |
| `pausedReason` / `pausedAt` | `String?` / `Timestamp?` | `operator hold` / `…` |
| `currentTool` | `String?` | `Bash` |
| `roundMetadata` | object (see 2.2) | — |

### 2.2 ReviewerRoundMetadata (convoy review rounds)

| Field | Type | Example |
|---|---|---|
| `roundCount` | `Integer` | `2` |
| `latestRound` | `Integer` | `2` |
| `latestStatus` | `String` | `APPROVED` |
| `history[]` | `Array` | see below |
| `history[].round` | `Integer` | `1` |
| `history[].status` | `String` | `CHANGES_REQUESTED` |
| `history[].startedAt` / `endedAt` | `Timestamp?` | `…` |
| `history[].durationSec` | `Duration (s)?` (nullable) | `420` |
| `history[].cost` | `Currency (USD)` | `2.10` |
| `history[].findings` | `Integer` | `1` |

### 2.3 Resources (`ProjectFeatureResourceDetails`, `WorkspaceData`)

| Field | Type | Example |
|---|---|---|
| `hasWorkspace` | `Boolean` | `true` |
| `localBranchCount` / `remoteBranchCount` | `Integer` | `1` / `1` |
| `tmuxSessionCount` | `Integer` | `3` |
| `prs[]` | `Array<{number,title,state,isDraft}>` | `[{number:1975,state:"OPEN",isDraft:false}]` |
| `hasVbrief` / `hasBeads` | `Boolean` | `true` / `true` |
| `dockerContainerCount` | `Integer` | `3` |
| `actualBranch` | `Git ref?` | `feature/pan-1866` |
| `branchDrifted` | `Boolean` | `false` |
| `workspaceMissing` | `Boolean` | `false` |
| `remoteAgent` | `{vmName,status,model,startedAt}?` | `null` |
| container `status` | `Enum(running\|stopped\|unhealthy\|restarting)` | `running` |
| container `cpuPercent` / `memoryUsage` | `Percent` / `String` | `0%` / `0KB` |
| container `health` | `Enum(healthy\|unhealthy\|starting\|unknown)` | `healthy` |
| `services[]` | `Array<{name,url}>` | `[{name:"frontend",url:"https://…"}]` |
| `frontendUrl` / `apiUrl` / `mrUrl` | `URL?` | `https://feature-pan-1866.pan.localhost` |
| `git` | `{ahead,behind,branch,dirty}` | `{ahead:2,behind:0,branch:"feature/pan-1866",dirty:false}` |
| `location` / `isRemote` / `vmName` | `Enum(local\|remote)` / `Boolean` / `String?` | `local` / `false` / `null` |
| `stackHealth` | `{healthy,reasons[],lastObserved}` | `{healthy:true,reasons:[],lastObserved:"…"}` |
| `pendingOperation` | `{type,status,startedAt,error?}?` | `null` |

---

## 3. The Tab Menu

The 15 tabs, in their current order. Each lists endpoint + every field shown.

### 3.1 Overview

Derived synthesis — no unique endpoint; composes review status + activity + PR/CI + costs.

| Field | Type | Example |
|---|---|---|
| Blocker spotlight text | `String` | `Flywheel auto-picks interactive planning issues despite FR-17 human gate` |
| Phase (Now) | `String` (derived) | `Review (failed)` |
| Active agent | `String` | `work · sonnet-4-6` |
| Review (Now) | `Enum` | `blocked` |
| Test (Now) | `Enum` | `pending` |
| Next action | `String` (derived) | `work agent fixes → re-review` |
| PR (Issue card) | `String` | `#1975 · mergeable` |
| CI checks (Issue card) | `String` | `4/5 passed` |
| Diff (Issue card) | `String` | `+5039 −42 · 61 files` |
| Verification (Issue card) | `Enum` + cycles | `pending` |
| Merge-ready (Issue card) | `Boolean→yes/no` | `no` |

### 3.2 Review (`ReviewVerificationCard` ← `useReviewStatusQuery`)

| Field | Type | Example |
|---|---|---|
| `reviewStatus` | `Enum(pending\|reviewing\|passed\|failed\|blocked)` | `blocked` |
| `reviewNotes` | `Markdown` | `Security blocker: FR-17 bypass` |
| 4 gate steps (Build/Review/Tests/Merge) | `Enum` each | `Review: blocked` |
| Verification gates (typecheck/lint/test/UAT) | `Enum` each | `typecheck: passed` |
| `verificationStatus` | `Enum(pending\|running\|passed\|failed\|skipped)` | `pending` |
| `verificationCycleCount` / `verificationMaxCycles` | `Integer` / `Integer` | `0` / `3` |
| `verificationNotes` | `Markdown` | `lint failed on 1 file` |
| Reviewer specialists | grid of reviewer `SessionNode` (role + verdict) | `Correctness ✓, Requirements ✕` |
| `blockerReasons[]` | `Array<{type,summary,details,detectedAt}>` | `[{type:"changes_requested",summary:"FR-17"}]` |
| actions | buttons | `Review & test`, `Restart review` |

### 3.3 Test (`TestPanel` ← `useReviewStatusQuery` + `useActivityQuery`)

| Field | Type | Example |
|---|---|---|
| `testStatus` | `Enum(pending\|testing\|passed\|failed\|skipped\|dispatch_failed)` | `pending` |
| Verification gate | `Enum` | `pending` |
| `verificationCycleCount` / max | `Integer` | `0 / 3` |
| Test agent session | `String` (sessionId · status) | `pan-1866-test · stopped` |
| `testNotes` | `Markdown` | `34/60 passing, 26 running` |
| gating note | `String` | `Test dispatch gated behind the review verdict` |

### 3.4 PR & CI (`GitHubCiPanel` ← `useIssueCheckRunsQuery`; `PullRequestData`)

PR object:

| Field | Type | Example |
|---|---|---|
| `number` | `Integer` | `1975` |
| `title` | `String` | `feat(sequencer): backlog DAG + reproducible md` |
| `url` | `URL` | `https://github.com/eltmon/overdeck/pull/1975` |
| `state` | `String` | `OPEN` |
| `isDraft` | `Boolean` | `false` |
| `baseRefName` / `headRefName` | `Git ref` | `main` / `feature/pan-1866` |
| `headRefOid` | `SHA` | `a3f9c1…` |
| `author` | `{login,name}` | `{login:"panopticon-agent[bot]"}` |
| `createdAt` / `updatedAt` | `Timestamp` | `…` |
| `reviewDecision` | `Enum(APPROVED\|CHANGES_REQUESTED\|REVIEW_REQUIRED)?` | `null` |
| `reviewRequests[]` | `Array<{login,name}>` | `[]` |
| `additions` / `deletions` / `changedFiles` | `Integer` | `5039` / `42` / `61` |
| `files[]` | `Array<{path,additions,deletions}>` | `[{path:"src/lib/sequencer/writeSequenceMd.ts",additions:318,deletions:0}]` |
| `labels[]` | `Array<{name,color}>` | `[{name:"feature",color:"a2eeef"}]` |
| `mergeable` | `Enum(MERGEABLE\|CONFLICTING\|UNKNOWN)?` | `MERGEABLE` |
| `body` | `Markdown` | `## Summary …` |
| `statusCheckRollup[]` | `Array<{name,state,conclusion,status,detailsUrl,workflowName}>` | `[{name:"lint",conclusion:"SUCCESS"}]` |

Check-runs:

| Field | Type | Example |
|---|---|---|
| `checkRuns[].id` | `Integer` | `42` |
| `checkRuns[].name` | `String` | `unit (frontend)` |
| `checkRuns[].status` | `Enum(queued\|in_progress\|completed)` | `completed` |
| `checkRuns[].conclusion` | `Enum(success\|failure\|cancelled\|skipped\|…)?` | `failure` |
| `checkRuns[].startedAt`/`completedAt` | `Timestamp?` | `…` |
| `checkRuns[].detailsUrl`/`htmlUrl` | `URL?` | `https://github.com/…/checks` |
| `checkRuns[].app` / `workflowName` | `String?` | `GitHub Actions` / `CI` |
| `summary.total/passed/failed/running/skipped/pending/cancelled` | `Integer` each | `5/4/1/0/0/0/0` |

### 3.5 Conversation (+ Terminal · About · Tools toggles)

`ChatMessage` (`chat-types.ts:6`):

| Field | Type | Example |
|---|---|---|
| `id` | `String` | `optimistic-msg-001` |
| `role` | `Enum(user\|assistant\|system)` | `assistant` |
| `text` | `Markdown` | `Both issues are clear. Fix 1: add readFileSync…` |
| `turnId` | `String?` | `turn-7` |
| `createdAt` / `completedAt` | `Timestamp` / `Timestamp?` | `…` |
| `streaming` | `Boolean` | `true` |
| `sequence` | `Integer` | `42` |

`WorkLogEntry` (tool call / thinking):

| Field | Type | Example |
|---|---|---|
| `id` | `String` | `wl-19` |
| `createdAt` | `Timestamp` | `…` |
| `label` / `toolTitle` | `String` | `Bash` |
| `detail` | `String` | `npm run typecheck` |
| `result` | `String` (output) | `0 errors` |
| `command` | `String?` | `npm run typecheck 2>&1 \| tail -10` |
| `changedFiles[]` | `Array<String>` | `["backlog.ts"]` |
| `tone` | `Enum(thinking\|tool\|info\|error)` | `tool` |
| `toolInput` | `Map<string,unknown>` | `{file_path:"backlog.ts"}` |

Composer + context window:

| Field | Type | Example |
|---|---|---|
| `model` | `String` | `claude-sonnet-4-6` |
| `harness` | `Enum(claude-code\|pi\|codex)` | `claude-code` |
| `effort` | `Enum(low\|medium\|high\|xhigh\|max)` | `medium` |
| `contextWindow` | `Tokens` | `200000` |
| `estimatedTokens` / `percentUsed` | `Tokens` / `Percent` | `12340` / `6.2` |
| `lastInputTokens` / `lastCacheReadTokens` / `lastCacheCreationTokens` | `Tokens` | `798` / `26000` / `0` |
| `lastModel` / `lastTurnAt` | `String?` / `Timestamp?` | `claude-sonnet-4-6` / `…` |
| **Terminal** toggle | live tmux stream (xterm) | — |
| **About** toggle | session metadata (see §2.1) | — |
| **Tools** toggle | hide/show tool calls | `Boolean` |
| Branch chip | `Git ref` + dirty state | `feature/pan-1866` |
| Delivery method | `Enum(auto\|channels\|tmux)` | `auto` |

### 3.6 Diff (`PrDiffTab` ← `usePrDiffQuery`)

| Field | Type | Example |
|---|---|---|
| `diff` | `String` (unified patch) | `@@ -0,0 +1,18 @@ …` |
| files list (from PR) | `Array<{path,additions,deletions}>` | `[{path:"…/writeSequenceMd.ts",additions:318,deletions:0}]` |
| per-file bar chart | derived from additions/deletions | — |
| CI rollup pills | from `statusCheckRollup` | `lint ✓` |
| review decision | `Enum?` | `null` |
| reviewers requested | `Array<{login}>` | `[]` |

### 3.7 Files (workspace file browser pane)

| Field | Type | Example |
|---|---|---|
| workspace `path` | `String` | `~/Projects/overdeck/workspaces/feature-pan-1866` |
| file tree | `Array<{path,type,size}>` | whole-workspace tree (not just changed) |
| (opens as a pane scoped to `issueId`+`agentId`) | — | — |

### 3.8 PRD / Plan (`VBriefTab` + `MarkdownTab` ← `usePlanningQuery`, `/workspaces/:id/plan`)

Planning summary:

| Field | Type | Example |
|---|---|---|
| `hasPrd` / `hasState` / `hasInference` | `Boolean` | `true` |
| `acceptanceProgress` | `{completed,total,percent}` | `{completed:18,total:20,percent:90}` |
| `prd` | `Markdown` | `# PRD: Backlog Sequencer …` |
| `state` | `Markdown` | `# STATE …` |
| `inference` | `Markdown` | auto-decisions narrative |
| `statusReview` | `Markdown` | `…` |
| `transcripts[]` / `discussions[]` / `notes[]` | `Array<{filename,content,uploadedAt,syncedAt}>` | `[{filename:"q1.md"}]` |
| `transcriptCount` / `discussionCount` / `noteCount` | `Integer` | `3` |
| `stashCount` | `Integer` | `0` |
| `statusReviewedAt` | `Timestamp` | `…` |

vBRIEF document (`vbrief/types.ts`):

| Field | Type | Example |
|---|---|---|
| `vBRIEFInfo.version` | `String` | `0.6` |
| `vBRIEFInfo.created` / `updated` | `Timestamp` | `…` |
| `vBRIEFInfo.author` | `String` | `planning · opus` |
| `vBRIEFInfo.inspectionPolicy` | `Enum(auto\|never\|fast\|deep)` | `auto` |
| `plan.id` | `String` | `pan-1866-plan` |
| `plan.title` | `String` | `Backlog Sequencer` |
| `plan.status` | `Enum(proposed\|approved\|running\|completed\|cancelled)` | `running` |
| `plan.uid` | `String (uuid)` | `…` |
| `plan.sequence` | `Integer` | `7` |
| `plan.narratives` | `{Problem,Proposal,Constraint,Risk,Alternative}` | `{Problem:"…"}` |
| `plan.tags[]` | `Array<String>` | `["epic","sequencer"]` |
| `plan.autoDecisions[]` | `Array<{summary,rationale}>` | `[{summary:"chose md over yaml"}]` |
| `plan.items[]` | `Array<VBriefItem>` | see below |
| `plan.edges[]` | `Array<{from,to,type}>` | `[{from:"item-1",to:"item-2",type:"blocks"}]` |

vBRIEF item:

| Field | Type | Example |
|---|---|---|
| `id` | `String` | `item-001` |
| `title` | `String` | `Implement writeSequenceMd` |
| `status` | `Enum(pending\|in_progress\|completed\|blocked\|cancelled)` | `completed` |
| `priority` | `Enum(critical\|high\|medium\|low)?` | `high` |
| `created` / `completed` | `Timestamp?` | `…` |
| `startDate`/`endDate`/`dueDate` | `Timestamp?` | `…` |
| `metadata.difficulty` | `Enum(trivial\|simple\|medium\|complex\|expert)` | `medium` |
| `metadata.files_scope[]` | `Array<String>` | `["src/lib/sequencer/*"]` |
| `metadata.phase` | `Integer?` | `1` |
| `metadata.requiresSynthesis` | `Boolean?` | `false` |
| `narrative.Action` | `Markdown` | `Render table + fenced JSON …` |
| `items[]` / `subItems[]` (ACs) | `Array<VBriefSubItem>` | `[{title:"emits valid JSON",metadata:{kind:"acceptance_criterion"}}]` |

### 3.9 Beads (`BeadsTasksPanel` ← `/issues/:id/beads`)

| Field | Type | Example |
|---|---|---|
| `issueId` | `String` | `PAN-1866` |
| `workspacePath` | `String` | `~/…/workspaces/feature-pan-1866` |
| `tasks[].id` | `String` | `pan-1866-7` |
| `tasks[].title` / `name` | `String` | `pan-1866: Implement writeSequenceMd` |
| `tasks[].status` | `Enum(open\|closed)` | `closed` |
| `tasks[].labels[]` | `Array<String>` | `["difficulty:medium"]` |
| `tasks[].blockedBy[]` / `blocks[]` | `Array<String>` | `["pan-1866-3"]` |
| `tasks[].createdAt` / `closedAt` | `Timestamp` / `Timestamp?` | `…` |
| open / closed counts | `Integer` | `0 open · 19 closed` |
| acceptance criteria (per bead, from vBRIEF) | `Array<{title,status}>` + `X/Y` | `3/3 AC` |
| graph view | DAG of items + edges | — |

### 3.10 Discussion (`DiscussionsTab` ← `useDiscussionsQuery`)

| Field | Type | Example |
|---|---|---|
| `items[].id` | `String` | `disc-12` |
| `items[].source` | `Enum(linear\|github-issue\|github-pr-conversation\|github-pr-review\|github-pr-review-comment)` | `github-pr-review` |
| `items[].author` | `String` | `requirements-reviewer` |
| `items[].body` | `Markdown` | `FR-17 requires a human approval…` |
| `items[].createdAt` | `Timestamp` | `…` |
| `items[].url` | `URL?` | `https://github.com/…#discussion_r…` |
| `items[].prNumber` | `Integer?` | `1975` |
| `items[].reviewState` | `String?` | `CHANGES_REQUESTED` |
| `items[].filePath` / `line` | `String?` / `Integer?` | `src/lib/cloister/flywheel/select.ts` / `212` |
| `prNumber` | `Integer?` | `1975` |
| `errors[]` | `Array<String>` | `[]` |

### 3.11 Costs (`CostsTab` ← `useIssueCostsQuery` + live stream)

| Field | Type | Example |
|---|---|---|
| `totalCost` | `Currency (USD)` | `67.72` |
| `resolvedTotalCost` / `aggregateCost` / `liveCost` | `Currency (USD)?` | `67.72` / `65.00` / `2.72` |
| `totalTokens` | `Tokens` | `4100000` |
| `inputTokens` / `outputTokens` | `Tokens?` | `3.6M` / `0.5M` |
| `byStage` | `Map<stage,{cost,tokens}>` | `{work:{cost:50.10,tokens:…}}` |
| `byModel` | `Map<model,{cost,tokens}>` | `{"sonnet-4-6":{cost:40.6}}` |
| `sessions[]` | `Array<SessionCost>` | see below |
| `sessions[].sessionId` / `agentId` | `String` | `pan-1866-work` |
| `sessions[].type` / `model` | `String` | `work` / `claude-sonnet-4-6` |
| `sessions[].startedAt` / `endedAt` | `Timestamp` / `Timestamp?` | `…` |
| `sessions[].cost` / `tokenCount` | `Currency (USD)` / `Tokens` | `50.10` / `…` |
| `lastUpdated` | `Timestamp` | `…` |

### 3.12 Activity (`ActivityTab` ← `useActivityQuery`)

| Field | Type | Example |
|---|---|---|
| `sections[].type` | `String` | `work`, `review`, `reviewer`, `test`, `ship`, `planning` |
| `sections[].sessionId` | `String` | `pan-1866-work` |
| `sections[].model` | `String` | `claude-sonnet-4-6` |
| `sections[].startedAt` | `Timestamp` | `…` |
| `sections[].duration` | `Duration (s)` (nullable) | `1234` |
| `sections[].status` | `String` | `running` |
| `sections[].role` | `String?` | `requirements` |
| `sections[].tmuxSession` | `String?` | `agent-pan-1866-work` |
| `sections[].roundMetadata` | object (§2.2) | — |
| `costByStage` | `Map<stage,{cost,tokens}>` | `{review:{cost:12.2}}` |
| `totalCost` / `aggregateCost` / `liveCost` / `resolvedTotalCost` | `Currency (USD)` | `67.72` |
| time-bucketed observations | grouped feed | `Just now`, `Earlier today`, … |

### 3.13 Artifacts (`DrawerArtifactsPanel` ← `/workspaces/:id/artifacts`)

| Field | Type | Example |
|---|---|---|
| `artifact.artifactId` | `String (ulid)` | `01JZ…` |
| `artifact.slug` | `String` | `k3p9m2qr` |
| `artifact.title` | `String?` | `Sequencer rationale — sample render` |
| `artifact.description` | `String?` | `…` |
| `artifact.filePath` | `String` | `src/lib/sequencer/sample.md` |
| `artifact.agentRole` | `Enum(plan\|work\|review\|test\|ship\|flywheel\|user)` | `work` |
| `artifact.agentHarness` | `Enum(claude-code\|pi\|codex\|user)` | `claude-code` |
| `artifact.currentHash` / `lastPublishedHash` | `String` / `String?` | `…` |
| `artifact.createdAt` / `publishedAt` / `unsharedAt` | `Timestamp?` | `…` |
| `status` | `Enum(published\|pending_changes\|unshared)` | `published` |
| `pendingChanges` | `Boolean` | `false` |
| `urls.wrapperUrl` / `rawUrl` | `URL` | `https://…` |
| `thumbnailUrl` | `URL?` | `https://…/thumb.png` |
| actions | buttons | `Open wrapper`, `Copy link`, `Unshare` |

### 3.14 History (`StatusHistoryTab` ← `reviewStatus.history`)

| Field | Type | Example |
|---|---|---|
| `history[].type` | `Enum(review\|test\|merge\|inspect\|uat\|verification)` | `review` |
| `history[].status` | `String` | `blocked` |
| `history[].timestamp` | `Timestamp` | `2026-06-20T16:45:00Z` |
| `history[].notes` | `Markdown?` | `FR-17 regression — changes requested` |

---

## Appendix — top-level merge/queue fields (header & pipeline derivations)

From `ReviewStatusData`, used across header, Overview, Review, Test, History:

| Field | Type | Example |
|---|---|---|
| `mergeStatus` | `Enum(pending\|queued\|merging\|verifying\|merged\|failed)` | `pending` |
| `mergeNotes` | `Markdown?` | `…` |
| `mergeRetryCount` | `Integer?` | `0` |
| `readyForMerge` | `Boolean` | `false` |
| `queuePosition` | `Integer?` (null=not queued, 0=active) | `null` |
| `activeSpecialist` | `Enum(review\|test\|merge)?` | `null` |
| `updatedAt` | `Timestamp` | `…` |

---

*Next iteration: re-map every row above onto the proposed cockpit (header /
agents+verification / conversation / beads rail / Quality·Code·Plan·Timeline·
Discussion·Costs·Artifacts groups) to prove the redesign is a strict superset.*
