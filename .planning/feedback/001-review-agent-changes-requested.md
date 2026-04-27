---
specialist: review-agent
issueId: PAN-858
outcome: changes-requested
timestamp: 2026-04-27T00:29:55Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-858 adds fit-and-finish to the Command Deck project tree: derived session labels, colored status pills, legacy session staleness filtering, orphan directory validation (fixing phantom 800/800 rows), indentation fixes, and filter button CSS extraction. The implementation is solid — 9 of 10 acceptance criteria are fully realized. However, two issues must block the merge: (1) a logic error in `isStaleLegacySession` that can cause active-but-errored legacy sessions to incorrectly disappear after 24h, and (2) a render cascade in the session tree delta path that causes O(total features) React re-renders per delta at scale. The requirements reviewer also notes that before screenshots are missing from the PR (REQ-10 partial) — per policy this is an administrative gap not a functional blocker, but the work agent should attach them.

## Blockers (MUST fix before merge)

### 1. `isStaleLegacySession` logic gates active-but-errored sessions incorrectly — `projects.ts:90` — `~`
**Raised by**: correctness
**Why it blocks**: A legacy session with `presence='active'` AND `status='error'` (tmux alive but agent crashed) falls through to the 24h age check and is hidden, making it impossible to diagnose or recover from the Command Deck.

```typescript
// Current (WRONG — uses AND):
if (s.presence !== 'ended' && s.status === 'running') return false;

// Fix — use OR so ANY non-ended presence is protected:
if (s.presence !== 'ended' || s.status === 'running') return false;
```

Or use the simpler presence-only guard: `if (s.presence !== 'ended') return false;`

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Session tree delta causes O(total features) React re-renders — `index.tsx:245` — `~`
**Raised by**: performance
**Why it matters**: When project A receives a `presence_changed` delta, `projectsWithSessions` re-creates feature objects for every project with a session tree (including B, C, D whose trees did not change). Each `FeatureItem` child gets a new prop identity and re-renders. With 5 projects × 20 features = 100 FeatureItems, every delta causes ~100 component re-renders. At scale with active agents generating frequent deltas, this is measurable JS execution cost.

The fix preserves feature object identities when sessions haven't changed — re-render count drops from O(total features) to O(features in affected project):

```typescript
const projectsWithSessions = useMemo(() => {
  return projects.map(project => {
    const tree = sessionTreeMap[project.name];
    if (!tree) return project;
    const featureSessions = new Map(...);
    let featuresChanged = false;
    const nextFeatures = project.features.map((feature) => {
      const treeSessions = featureSessions.get(feature.issueId.toLowerCase());
      if (!treeSessions && !feature.sessions) return feature;
      if (treeSessions === feature.sessions) return feature; // same ref
      featuresChanged = true;
      return { ...feature, sessions: treeSessions ?? feature.sessions };
    });
    if (!featuresChanged) return project;
    return { ...project, features: nextFeatures };
  });
}, [projects, sessionTreeMap]);
```

## Nits (advisory — safe to defer)

- `SessionNode.tsx:216` — `?` — Dynamic CSS module class lookup (`styles[\`sessionStatus_${session.status}\`]`) is safe with the `?? ''` fallback but the CSS-class-to-type coupling is manual and not enforced by the type system. Not actionable now.
- `command-deck.ts:1309`, `projects.ts:220` — `?` — `issueLower` naming is misleading (it's the raw directory name with `feature-` stripped, not a lowercase conversion). Rename to `issueSlug` or `rawName` when convenient.

## Cross-cutting groups

**_none_**

## What's good
- Session label derivation (`deriveSessionLabel`) is exhaustive over all 7 `SessionNodeType` literals and correctly handles legacy naming.
- Regex validation (`/^[a-z]+-\d+$/`) is applied consistently in both `command-deck.ts` and `projects.ts` — the phantom `800/800` row is fixed at source.
- Status pill CSS classes cover all 5 `AgentStatus` variants with semantic colors.
- Security review is clean — no new attack surface introduced.
- All 6 beads tasks from the planning STATE.md are traced to code changes.

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 2
- By reviewer: correctness=3, security=0, performance=3, requirements=4 (1 partial)
- Files touched: 8 source files + 5 non-code files

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-858 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

