---
specialist: verification-gate
issueId: PAN-936
outcome: failed
timestamp: 2026-05-03T10:40:34Z
---

VERIFICATION FAILED for PAN-936 (attempt 1/10):

Failed check: test

Verification FAILED at test (33159ms):

: without installing the canvas npm package

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  tests/fixtures/synced-skills.test.ts > synced skill set fixture > matches the committed fixture line-for-line
AssertionError: expected 'all-up\nbeads\nbeads-completion-check…' to be 'all-up\nbeads\nbeads-completion-check…' // Object.is equality

- Expected
+ Received

  all-up
  beads
  beads-completion-check
  beads-panopticon-guide
  benchmark
  bug-fix
  check-merged
  clear-writing
  cliproxy
  code-review
  code-review-performance
  code-review-security
  conv-lookup
  crash-investigation
  dependency-update
  feature-work
  github-cli
  incident-response
  knowledge-capture
  myn-standards
  onboard-codebase
  pan
  pan-admin-cloister
  pan-admin-config
  pan-admin-hooks
  pan-admin-tldr
  pan-admin-tracker
  pan-approve
  pan-close
  pan-code-review
  pan-convoy-synthesis
  pan-dev
  pan-diagnose
  pan-docker
  pan-docs
  pan-done
  pan-down
  pan-fly
  pan-health
  pan-help
  pan-install
  pan-issues
  pan-kill
  pan-logs
  pan-network
  pan-new-project
  pan-oversee
  pan-plan
  pan-projects
  pan-quickstart
  pan-release
  pan-reload
  pan-reopen
+ pan-resources
  pan-restart
  pan-review
  pan-show
  pan-skill-creator
  pan-start
  pan-status
  pan-stop-all-agents
  pan-subagent-creator
  pan-sync
  pan-sync-main
  pan-tell
  pan-test-config
  pan-tts
  pan-up
  pan-wipe
  pan-workspace-config
  plan
  react-best-practices
  refactor
  refactor-radar
  release
  send-feedback-to-agent
  session-health
  skill-creator
  spec-readiness
  spec-readiness-setup
  stitch-design-md
  stitch-react-components
  stitch-setup
  unarchive-conversation
  web-design-guidelines
  work-complete
  workspace-status
  write-spec


 ❯ tests/fixtures/synced-skills.test.ts:53:20
     51| 
     52|     const expected = readFileSync(FIXTURE_PATH, 'utf-8');
     53|     expect(actual).toBe(expected);
       |                    ^
     54|   });
     55| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-936 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-936 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
