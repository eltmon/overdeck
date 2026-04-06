# PAN-489: Bare numeric issue IDs cause cross-tracker pollution

## Status: In Progress

## Current Phase
Implementing bead feature-pan-489-3u4: Migration scan — warn on bare numeric issueIds in state files at startup

## Completed Work
- [x] feature-pan-489-ly3: Reordered tracker priority — github_repo before issue_prefix in transitionIssueState; 5 tests (commit: fb06757)

## Remaining Work
- [x] feature-pan-489-ly3: Fix tracker priority — check github_repo before issue_prefix in transitionIssueState (commit: fb06757)
- [x] feature-pan-489-7pj: Guard bare numeric IDs — warn and skip in transitionIssueState (commit: 6022189)
- [x] feature-pan-489-z90: Validate issue ID format — 422 in route + AgentStartError in spawner, with tests
- [ ] feature-pan-489-3u4: Migration scan — warn on bare numeric issueIds in state files at startup

## Key Decisions
- D1: getWorkspaceInfoForIssue() legacy path fallback was already implemented in commit be33bfb. Only these 4 fixes remain.
- D2: Projects with github_repo should use GitHub tracker regardless of issue_prefix being set. issue_prefix is now used for both GitHub and Linear projects as just a naming prefix.
- D3: Bare numeric IDs must be caught at transitionIssueState (warn+skip), agent spawn validation (reject), and startup scan (warn).

## Specialist Feedback
(none yet)
