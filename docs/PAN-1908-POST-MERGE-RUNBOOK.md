# PAN-1908 Post-Merge Close-Out Runbook

**Execute only after the PAN-1908 PR has been merged to `main`.** This runbook performs the external tracker hygiene and Panopticon pipeline cleanup mandated by PRD §12. It is intentionally manual — implementation agents MUST NOT run these commands before merge (D5).

## 1. Prerequisites

- [ ] PAN-1908 PR is merged to `origin/main`.
- [ ] The merged PR number is known (replace `<PR>` in commands below).
- [ ] You are on a machine with `gh` authenticated and `pan` available.

## 2. §12a — Close fully resolved issues (5)

For each issue below, close the GitHub issue with a comment referencing this PRD/PR, then clear its Panopticon pipeline state.

### PAN-1436 — stale stopped-agent zombies pollute the dashboard list

```bash
gh issue close 1436 --repo eltmon/panopticon-cli \
  --comment "Resolved by PAN-1908 (#<PR>). Dead agents are no longer enumerated from the directory; the SQLite agents table is now the authoritative runtime registry."
pan admin db clear-review-status PAN-1436 || true
pan admin db clear-merge-rows PAN-1436 || true
pan close PAN-1436 --force || true
```

### PAN-1689 — Paused/troubled card inflated by stale stopped sub-agent tombstones

```bash
gh issue close 1689 --repo eltmon/panopticon-cli \
  --comment "Resolved by PAN-1908 (#<PR>). Stale stopped-agent tombstones are no longer enumerated from the filesystem; runtime status comes from the agents table."
pan admin db clear-review-status PAN-1689 || true
pan admin db clear-merge-rows PAN-1689 || true
pan close PAN-1689 --force || true
```

### PAN-832 — state.json staleness (lastActivity/costSoFar frozen; /api/agents drops phase/cost)

```bash
gh issue close 832 --repo eltmon/panopticon-cli \
  --comment "Resolved by PAN-1908 (#<PR>). Agent state is now written transactionally to the SQLite agents table per lifecycle event; state.json is kept only as a rollback/rebuild source."
pan admin db clear-review-status PAN-832 || true
pan admin db clear-merge-rows PAN-832 || true
pan close PAN-832 --force || true
```

### PAN-1846 — unbounded deacon.log growth from per-agent patrol skip lines

```bash
gh issue close 1846 --repo eltmon/panopticon-cli \
  --comment "Resolved by PAN-1908 (#<PR>). The per-agent directory-scan patrol is removed; deacon recovery reacts to lifecycle events and thin SQLite safety nets instead of O(all-agents) scans."
pan admin db clear-review-status PAN-1846 || true
pan admin db clear-merge-rows PAN-1846 || true
pan close PAN-1846 --force || true
```

### PAN-1711 — dashboard event-loop stalls under load

```bash
gh issue close 1711 --repo eltmon/panopticon-cli \
  --comment "Resolved by PAN-1908 (#<PR>). All O(all-agents) filesystem scans are removed from runtime status paths; the dashboard reads from the SQLite agents table and event-driven read model."
pan admin db clear-review-status PAN-1711 || true
pan admin db clear-merge-rows PAN-1711 || true
pan close PAN-1711 --force || true
```

### Pipeline-row cleanup checklist for all §12a issues

If the `pan admin db clear-*` commands do not exist, run the equivalent SQL directly against `~/.panopticon/panopticon.db`:

```sql
DELETE FROM review_status WHERE issue_id = '<ISSUE>';
DELETE FROM merge_sets WHERE issue_id = '<ISSUE>';
DELETE FROM merge_set_repos WHERE issue_id = '<ISSUE>';
DELETE FROM merge_queue WHERE issue_id = '<ISSUE>';
DELETE FROM pending_auto_merges WHERE issue_id = '<ISSUE>';
```

Also tear down any leftover workspace/branch/agent for the issue:

```bash
pan wipe PAN-XXXX --confirm   # only if the issue has no value left; otherwise pan close
```

## 3. §12b — Narrow partially subsumed issues (12)

For each issue below, **do NOT close**. Instead, update the title or labels to describe the remaining scope and add a comment explaining what PAN-1908 delivered.

```bash
# Template command — substitute issue number and remaining-scope text
gh issue edit <NUMBER> --repo eltmon/panopticon-cli \
  --title "<remaining scope>" \
  --add-label " narrowed-by-pan-1908"
gh issue comment <NUMBER> --repo eltmon/panopticon-cli \
  --body "Partially addressed by PAN-1908 (#<PR>). The agent-state / per-issue record work in PAN-1908 covers: <what it delivered>. Remaining scope: <what is still open>."
```

| Issue | Remaining scope after PAN-1908 |
|-------|-------------------------------|
| [PAN-541](https://github.com/eltmon/panopticon-cli/issues/541) | Specialist `.session` files and compact-offset migration to SQLite/db. |
| [PAN-1888](https://github.com/eltmon/panopticon-cli/issues/1888) | Remove the legacy stop-hook `review-status.json` writer entirely. |
| [PAN-1325](https://github.com/eltmon/panopticon-cli/issues/1325) | Canonical infra-repo setup for `docs/prds` and per-project configuration. |
| [PAN-944](https://github.com/eltmon/panopticon-cli/issues/944) | Collapse beads and vBRIEF into a single durable per-issue record. |
| [PAN-456](https://github.com/eltmon/panopticon-cli/issues/456) | Resume-on-restart logic using persisted harness session ids. |
| [PAN-793](https://github.com/eltmon/panopticon-cli/issues/793) | Formal agent state-machine model and documentation. |
| [PAN-1037](https://github.com/eltmon/panopticon-cli/issues/1037) | Retire the `planning-` prefix in remaining call sites. |
| [PAN-111](https://github.com/eltmon/panopticon-cli/issues/111) | Planning-specific cross-machine sync UX. |
| [PAN-1650](https://github.com/eltmon/panopticon-cli/issues/1650) | `readyForMerge` field rename and `gatesPassed` trigger. |
| [PAN-1219](https://github.com/eltmon/panopticon-cli/issues/1219) | Review `cycle.json` findings model. |
| [PAN-77](https://github.com/eltmon/panopticon-cli/issues/77) | Dashboard cost-breakdown modal UI. |
| [PAN-1482](https://github.com/eltmon/panopticon-cli/issues/1482) | Report generator wiring and UI. |

## 4. Verification

After running the §12a closes and §12b narrows:

1. Confirm each §12a issue shows `closed` on GitHub.
2. Confirm the issues no longer appear in the Panopticon Command Deck or `pan status` output.
3. Confirm each §12b issue has a comment referencing PAN-1908 and a narrowed title or `narrowed-by-pan-1908` label.
4. Run `pan doctor` to verify no orphaned review-status/merge rows reference the closed issues.

## 5. What NOT to do

- Do not run `gh issue close` before the PAN-1908 PR merges.
- Do not run destructive `pan wipe` on an issue that has a workspace worth preserving.
- Do not close any §12b issue; relabel/narrow only.
