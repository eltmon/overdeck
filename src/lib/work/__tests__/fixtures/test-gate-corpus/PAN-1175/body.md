**Found during:** /all-up flywheel run (2026-05-18), launching SWARM on PAN-1148.

## Symptom

\`pan swarm PAN-1148 --auto-advance --max-slots 2\` fails immediately with:

\`\`\`
✖ Failed: Failed to dispatch any slots for PAN-1148 wave 0.
\`\`\`

The actual error (from the /api/swarm response body):

\`\`\`json
{ \"errors\": [\"Slot 1: failed to create worktree — Cannot dispatch swarm from non-feature parent branch main\"] }
\`\`\`

Reproduces with --host --yes, --max-slots 1, etc. Not fixable from the caller — it's structural.

## Root cause

\`src/dashboard/server/routes/swarm.ts:1599-1622\`:

\`\`\`ts
async function resolveParentFeatureBranch(
  projectPath: string,
  issueUpper: string,
  localList: string[],
  remoteList: string[],
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: projectPath });
  const currentBranch = stdout.trim();
  // ...
  if (!currentBranch.startsWith('feature/') || /-slot-\d+$/.test(currentBranch)) {
    throw new Error(\`Cannot dispatch swarm from non-feature parent branch \${currentBranch}\`);
  }
  // ...
}
\`\`\`

\`projectPath\` is the MAIN repo root (from \`resolveProjectFromIssue(issueId).projectPath\`). Feature branches in this project live in **worktrees** at \`workspaces/feature-<issue>/\`, which means the main repo CANNOT have a feature branch checked out — \`git\` forbids the same branch being checked out in multiple worktrees. The check is structurally impossible to satisfy from the main repo.

## Reproduction

\`\`\`bash
cd /home/eltmon/Projects/overdeck
git branch --show-current  # → main
pan swarm PAN-1148 --auto-advance --max-slots 2
# → Failed to dispatch any slots for PAN-1148 wave 0.
\`\`\`

## Fix

Replace the \`git branch --show-current\` check with a direct lookup against \`localList\` (and \`remoteList\` as fallback) — which the caller already computed. The intent is to verify a feature branch exists for this issue; checking \`localList\` for either \`feature/<lowercase-id>\` or \`feature/<numeric>\` accomplishes that without requiring the main repo to be on that branch (which is impossible).

\`\`\`ts
const legacyIssueBranch = \`feature/\${issueUpper.toLowerCase()}\`;
const issueNumber = issueUpper.split('-').at(-1);
const numericIssueBranch = issueNumber ? \`feature/\${issueNumber.toLowerCase()}\` : null;

const candidates = [legacyIssueBranch, numericIssueBranch].filter(Boolean) as string[];
for (const candidate of candidates) {
  if (localList.includes(candidate) || remoteList.includes(\`origin/\${candidate}\`)) {
    return candidate;
  }
}
throw new Error(\`No feature branch found for \${issueUpper} (looked for \${candidates.join(', ')})\`);
\`\`\`

## Severity

P0 / blocker for SWARM. No workaround — the check is impossible to satisfy structurally.

This bug means SWARM has likely never worked in production for the main host repo. PAN-970 / PAN-977 wave swarm tests presumably ran in-container or with a fake-projectPath scenario.

--- comment ---
Code audit result: COMPLETE.

Audited against the original SWARM parent-branch cwd issue and current main.

Evidence:
- Parent feature branch is resolved from local/remote branch lists, looking for `feature/<issue>` and `feature/<number>`: `src/dashboard/server/routes/swarm.ts:2016-2042`.
- The route obtains branch lists with `git branch --list` and `git branch -r --list`: `src/dashboard/server/routes/swarm.ts:2064-2068`.
- Slot branch creation/reuse uses that resolved parent branch: `src/dashboard/server/routes/swarm.ts:2073-2087`.
- The old current-branch gate is gone; `rg "branch --show-current|Cannot dispatch swarm from non-feature parent branch" src/dashboard/server/routes/swarm.ts` only finds an explanatory comment.

Verification: `npx vitest run src/dashboard/server/routes/__tests__/swarm.test.ts` passed (`47` tests).
