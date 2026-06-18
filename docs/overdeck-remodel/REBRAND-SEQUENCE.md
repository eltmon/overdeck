# Overdeck Rebrand — Change Sequence & Coordination

One ordered plan for the **Panopticon → Overdeck** rebrand. Every change is mapped to
its owner — a tracked issue or a manual operator op — so the in-repo edits, the
external infra ops (GitHub repo rename, DNS, npm), and the data cutover don't step on
each other.

> Status: planning. Order below is a **recommendation** — adjust and this doc is the
> source of truth for who-does-what-when.

## The core simplicity principle

Keep two kinds of work cleanly separated:

- **(a) In-repo reference edits** — one reviewable, re-runnable codemod on a branch
  (`overdeck-rebrand`). Atomic, gated by build/lint/test.
- **(b) External infra ops** — GitHub repo rename, DNS/domain, npm scope. Manual,
  done in the GitHub/registrar/npm consoles.

Then **sequence the external ops so the codemod's new references resolve the moment
they go live.** The enabling fact: **GitHub 301-redirects the old repo name forever
after a rename.** So renaming the repo *early* makes every `eltmon/overdeck` reference
valid immediately, while every lingering `eltmon/panopticon-cli` link still works via
redirect — a **zero-broken-link window**.

## Branch topology

| Branch | Contents | Role |
| --- | --- | --- |
| `main` | old `panopticon.db` code + PAN-1963 | live trunk; the rebrand is **not** here yet |
| `cutover-stage` | `main` + overdeck.db data refactor | frozen refactor-only fallback — **never delete** |
| `overdeck-rebrand` | `cutover-stage` + the rebrand codemod | where Phase 3 happens; merges to `main` at final cutover |

Final cutover = merge `overdeck-rebrand` → `main` (forced-tree merge; see the
"revert-the-revert gotcha" section in PAN-1960).

## Recommended order

| Phase | What | Owner | Depends on |
| --- | --- | --- | --- |
| **0** | **Data refactor** — `panopticon.db` → `overdeck.db` (two-door), events off `panopticon.db`, empty-by-default boot | **DONE** — `cutover-stage` · PAN-1938 / PAN-1960 | — |
| **1** | **Rename GitHub repo** `panopticon-cli` → `overdeck`; update local remote (`git remote set-url origin git@github.com:eltmon/overdeck.git`) | **Manual** (operator) | — |
| **2** | **Stand up `overdeck.ai`** + 301-redirect `panopticon-cli.com` → `overdeck.ai` | **Manual** (operator) | — |
| **3** | **In-repo reference rename (codemod)** — all code + docs (details below) | **PAN-1964** | Phase 0 (branch base) |
| **4** | **Final cutover** — merge `overdeck-rebrand` → `main`, build (Node 22), boot fresh empty `~/.overdeck` | **PAN-1960** procedure / operator | Phases 1, 2, 3 |
| **5** | **npm publish** — reserve `@overdeck` scope, publish `@overdeck/*`, deprecate `@panctl/*` | **Manual** / PAN-1952 | Phase 3 (names already `@overdeck`) |
| **6** | **Legacy cleanup** — remove the `panopticon.db` / `~/.panopticon` rollback/import references | **new follow-up issue** | Phase 4 go-live |

**Why this order is the simplest:** Phases 1–2 (with their redirects) make the
codemod's new repo/domain references resolve immediately. The codemod itself
(Phase 3) is safe to land on the branch at any time; the **hard gate** is Phase 4 —
**Phases 1 and 2 must be live before the rebrand merges to `main`**, or the
`eltmon/overdeck` / `overdeck.ai` references that land on the trunk break for users.
npm (Phase 5) is independent: the monorepo builds locally via Bun workspaces
regardless of whether `@overdeck` is published — publishing only matters for external
consumers, so it can come last.

> **Alternative discussed (codemod-first):** running Phase 3 before Phases 1–2 is also
> fine, because the rebrand only reaches users at Phase 4. The doc's only firm
> constraint is: **repo rename + domain redirect live *before* final cutover.**

## Phase 3 detail — what PAN-1964 changes

**Rename → Overdeck (in scope):**

- `Panopticon` brand word — docs, comments, UI/log/help strings, **and** code symbols.
- `PANOPTICON_*` → `OVERDECK_*` (95 env vars).
- `.panopticon` live home → `.overdeck`; `.pan/` project dir → `.overdeck/` (**literals only**).
- `@panctl/*` → `@overdeck/*` (package names + imports); bin `panctl` → `overdeck`.
- tmux socket `panopticon` → `overdeck`.
- CLI: program name `overdeck`, **`pan` kept as alias**.
- **Repo + domain references** (now in scope, since both are being renamed):
  `panopticon-cli` / `eltmon/panopticon-cli` → `eltmon/overdeck`;
  `panopticon-cli.com` → `overdeck.ai`; `package.json` `repository` / `homepage` /
  `bugs` URLs.

**Carve-outs (do NOT change):**

- `PAN-` / `MIN-` issue prefixes.
- `panopticon.db` + the legacy `~/.panopticon` home in **rollback/import read paths
  only** (dedicated legacy-home resolver). Removed later in Phase 6.
- Lock files, `dist/`, `*.map`, generated artifacts.

**No on-disk migration:** change dir *literals* only; do not move `~/.panopticon` or
the repo's own `.pan/` on disk. At cutover the new code looks for `~/.overdeck` —
absent → **comes up empty by design** (fresh start; manual rename optional).

## Dependency / mechanics notes

- **GitHub repo rename** — old URLs 301-redirect permanently; clones, issue links, and
  PR links keep working. `PAN-####` *is* GitHub issue `#####` in whatever the repo is
  named, so issue references survive the rename unchanged.
- **Domain** — keep `panopticon-cli.com` alive with a 301 to `overdeck.ai` so docs that
  still say the old domain (e.g. external/cached copies) don't 404.
- **npm** — `@panctl/*` stays published + deprecated; `@overdeck/*` published fresh.
  The in-repo name change (Phase 3) does not require a publish to build.
- **Issue prefixes stay `PAN-`/`MIN-`** — the tracker identity is not the brand.

## Issue / owner map

| Item | Owner | Scope |
| --- | --- | --- |
| Umbrella | **PAN-1938** (EPIC) | Data remodel + Overdeck rebrand |
| Data cutover mechanics | **PAN-1960** | `overdeck.db` cutover + final forced-tree merge procedure |
| In-repo reference rename | **PAN-1964** | Phase 3 — **the "first step" being done now** |
| Rollout / namespace | **PAN-1952** | now mostly Phases 1, 2, 5 (manual) + back-compat; see open question |
| Repo rename, domain, npm | **Manual** (operator) | Phases 1, 2, 5-external |
| Legacy ref removal | **TBD new issue** | Phase 6 |

## Open coordination questions

1. **Confirm the order** — repo rename (Phase 1) early, or codemod (Phase 3) first?
   Either works; the firm gate is repo+domain live before final cutover (Phase 4).
2. **PAN-1952 reframe** — with the codemod (PAN-1964), the manual ops, and Phase 6
   covering most of the rename, PAN-1952 now overlaps heavily. Reframe PAN-1952 as
   just the *rollout* (npm publish + back-compat + announcement), or fold it into this
   sequence and close it?
