# OKF Landscape — How Overdeck and the Ecosystem Store, Generate, and Review Knowledge Bundles

Research survey (2026-07-17): how Overdeck manages its Open Knowledge Format (OKF)
bundle, how the wider OKF ecosystem stores/generates/reviews bundles relative to
codebases, whether anyone uses branch-based storage like our `overdeck-state`
orphan branch, and what proposals exist upstream. Compiled from the OKF spec,
GitHub adopter repos, spec-repo issues/discussions, and Overdeck's own design
history (PAN-2468, PAN-2066, and the June–July 2026 design conversations).

---

## 1. What OKF is

- **Spec:** [`okf/SPEC.md` in GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), published by Google Cloud's Data Cloud team, announced 2026-06-12 ([blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)). Current version **v0.1 (Draft)**.
- A bundle is a directory of markdown files. Every non-reserved `.md` is a
  "concept" with YAML frontmatter (`type` is the only required key); reserved
  files are `index.md` (progressive-disclosure catalog) and `log.md`
  (newest-first change history). The spec formalizes Karpathy's
  ["LLM wiki" pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
- **The spec's opinion on WHERE a bundle lives is deliberately weak.** SPEC.md §3:
  a bundle MAY be distributed as *"a git repository (recommended — provides
  history, attribution, diffs), a tarball or zip archive, or a subdirectory
  within a larger repository."* No directory names, no branch strategy, no repo
  topology, no schema registry, no required tooling.
- Community hub: [okf.md](https://okf.md/) (annotated spec, [ecosystem map](https://okf.md/ecosystem-map/)).
  The unofficial guide's practical advice: most common setup will be a
  `knowledge/` or `docs/catalog/` directory inside the monorepo, because "the
  agent can look at schemas AND OKF documentation in the same `git clone`."

## 2. How Overdeck manages OKF

### Storage: sibling companion repo, pointer file, PR-gated writes

`/okf init` (shipped in [PAN-2468](https://github.com/eltmon/overdeck/issues/2468),
PR #2488, merged ~2026-07-09) offers three placements:

1. **Peer repo, local only** — `../<project>-knowledge` (default recommendation)
2. **Peer repo + GitHub remote** — same, pushed to a `<project>-knowledge` repo
3. **In-repo subdirectory** — `--local <subdir>`, no companion repo

Plus `--dir <path>` for any arbitrary external directory. The authoritative
pointer is **`.okf.yml` at the code-repo root** (`bundle:` + `remote:`); the
`<project>-knowledge` name is convention only, and the pointer always wins over
the naming convention. Resolution order: host project config `knowledge_repo` →
`.okf.yml` → clear error telling the user to run `/okf init`.

Writes are **PR-gated**: agents prepare knowledge changes on branches in the
knowledge repo; a deterministic Python CI conformance gate
(`validate.py --strict` + `diff_lint.py`) blocks merge on nonconformance. The
gate is deliberately *not* an LLM auditor — deterministic checks are cheaper and
cannot hallucinate a pass. Sync never pushes directly to the default branch.

Key design decisions from the June 25–26 and July 7–9 sessions:

- Skill sources live in the overdeck repo (`sync-sources/skills/okf/`) but are
  **self-contained with no Overdeck imports**, so `/okf` works for non-Overdeck
  users; Overdeck users additionally get `pan knowledge`, the knowledge role,
  session-start injection, and the (config-gated, default-off) post-merge
  auto-retro hook.
- Wiki loops: `study "<focus>"` (pre-feature: document what exists), `retro`
  (post-implementation: what would have made this easier if documented?),
  `sync [--topic]` (diff-driven), `lint` (advisory semantic patrol). Full verb
  surface: init / author / convert / sync / study / retro / extract / validate /
  lint / embed.
- **okf-embeddings v0.1 extension:** committed, shareable vector shards
  (`embeddings/<profile>.okfe.jsonl`, content-hash keyed) + committed
  `okf-embeddings.yaml` manifest + gitignored derived SQLite index. Committed
  rather than gitignored specifically so teams can leverage each other's
  embeddings; intended as an upstream extension proposal. Keyless default via
  local Ollama.
- No SessionStart hooks or ambient subagents in v1 (deliberately avoiding the
  theesfeld "prime directive" hook failure mode and Overdeck's
  no-ambient-subagent policy).

### The viewer: progressive, read-only OpenKnowledge integration

[PAN-2066](https://github.com/eltmon/overdeck/issues/2066) adopted
[`inkeep/open-knowledge`](https://github.com/inkeep/open-knowledge) for visual
browsing, graph navigation, search, and optional MCP access. The GPL-3.0-or-later
package remains an arm's-length global program: Overdeck never imports, links,
or bundles it into the MIT-licensed `@overdeck/*` packages. Overdeck invokes the
`ok` executable as a subprocess and communicates over HTTP and WebSocket.

The integration is progressive:

1. `pan install` does not install OpenKnowledge. The first explicit
   `pan knowledge open`, `/okf open`, or dashboard **Install viewer** action may
   install it globally; `--no-install` requires an existing installation.
2. The server owns one viewer process per project, reuses healthy lock-reported
   processes, and proxies every HTTP and WebSocket path through a project-keyed,
   origin-isolated `knowledge-<hex>.<dashboard-domain>` host. Short-lived viewer
   credentials never expose dashboard cookies or internal headers upstream.
3. Every viewer runs against a disposable snapshot outside the canonical bundle.
   OpenKnowledge may accept edits inside that projection, but those writes cannot
   reach the PR-gated source and are discarded when the snapshot is refreshed.
4. The dashboard **Knowledge** page represents missing-bundle, not-installed,
   installing, starting, embedded, and framing-blocked states. When framing is
   refused, it offers the viewer's direct local URL in a new tab.
5. `ok init` MCP registration is always a separate opt-in action. Unattended
   viewer initialization uses `--no-mcp --no-skills`, so opening the viewer
   never changes Claude Code, Codex, or Cursor configuration.

The mandatory round-trip spike on OpenKnowledge v0.34.0 found source-format
loss: editing only `description` also rewrote an unrelated inline YAML `tags`
array. The integrated dashboard is therefore mechanically read-only with respect
to the canonical bundle: both the dashboard and CLI launch a disposable snapshot,
so viewer edits are discarded rather than reaching source files. Operators browse
and search there, then use `/okf author` for PR-gated edits that preserve unknown
frontmatter and pass deterministic conformance checks. Lease-based
writes and the advisory semantic auditor remain deferred capabilities rather
than viewer responsibilities.

### Our own bundle so far

[`eltmon/overdeck-knowledge`](https://github.com/eltmon/overdeck-knowledge)
(private, sibling checkout at `../overdeck-knowledge`), created via `/okf init`
on 2026-07-14 with the "peer repo + GitHub remote" option:

- **2026-07-07 in `log.md` / 2026-07-14 actual:** bundle initialized — scaffold
  (README, CONTRIBUTING, CODEOWNERS, conformance CI), stub `overview.md`, a
  `decisions/initial.md` record, and `okf-embeddings.yaml` (Ollama
  `nomic-embed-text`, 768-dim, concept-chunked, shards shared).
- **2026-07-14:** `/okf study "overdeck front end"` → **13 frontend concepts**
  under `frontend/` (overview, data-flow, state-management, command-deck,
  stage-and-cockpit, kanban-board, pipeline-and-backlog, issue-actions,
  settings-and-model-routing, conversation-ui, terminal-panel, style-system,
  context-engineering-ui), landed via PR #1 with green conformance CI. Two
  skill bugs were fixed at source during this first real use (reindex dragging
  `.git/` into the index; conformance CI checking out the code repo inside the
  bundle).
- Work-agent sessions (e.g. PAN-1897, PAN-1966 workspaces) now show `/okf
  extract` concept output injected into agent context — the extract/injection
  loop is live.

Total: 21 markdown files. The backend, CLI, cloister, and pipeline domains are
not yet studied — the bundle covers the frontend only.

## 3. How the ecosystem stores OKF bundles relative to codebases

Observed patterns, roughly in order of prevalence:

**(a) In-repo folder — dominant.**
`okf/` at the project root ([theesfeld/claude-okf](https://github.com/theesfeld/claude-okf)
defaults there), `docs/okf/` (Linux Foundation
[lfx-self-serve PR #1049](https://github.com/linuxfoundation/lfx-self-serve/pull/1049),
31 concepts + zero-dep validator), OKF frontmatter applied to existing `docs/**`
(NEXTAltair/LoRAIro family, ADR-driven, Makefile CI gates), plus adopters like
[wesnoth-2077 PR #1](https://github.com/mattiabestiaccia/wesnoth-2077/pull/1),
[airsstack PR #28](https://github.com/rstlix0x0/airsstack/pull/28), and
[langchain-ai/openwiki](https://github.com/langchain-ai/openwiki) generating an
in-repo `openwiki/` directory. Google's own repo keeps the spec + sample
bundles as a subdirectory.

**(b) Separate / dedicated knowledge repo — our pattern.**
[supachai-j/open-knowledge-format-starter](https://github.com/supachai-j/open-knowledge-format-starter)
(standalone KB repo: `raw/` immutable sources → `wiki/` OKF bundle; "Git is the
source of truth; an internal MCP server is the access layer"),
[jkroepke/okf-crossplane-v2](https://github.com/jkroepke/okf-crossplane-v2),
`*-knowledge` repos like mbgulden/growthwebdev-knowledge and AS215932/knowledge
(the latter with a "collector → reviewed ledger PR" CI sync), and
[romansklenar/rails-codex PR #11](https://github.com/romansklenar/rails-codex/pull/11)
migrating a KB repo wholesale to OKF.

**(c) Git submodule — one confirmed merged case.**
[LoRAIro PR #973](https://github.com/NEXTAltair/LoRAIro/pull/973): OKF docs live
in submodules pinned into the parent repo, with validator scripts kept
byte-identical across three repos.

**(d) Dedicated/orphan branch — nobody.** See §4.

**(e) Storage-agnostic tooling.**
[inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) is
folder-first and git-optional ("open any existing folder… codebases, wikis,
Obsidian vaults"); registries like [BundleDex](https://bundledex.net/) index
published bundles.

## 4. Branch-based storage — is anyone doing what `overdeck-state` does?

**For OKF specifically: no.** Searches of the spec repo's issues/discussions,
GitHub-wide issue and code search, and the general web found **zero cases of an
OKF bundle stored on a same-repo orphan or dedicated branch**. The spec is
silent on branches; okf.md says only that you can "diff, branch, review
knowledge like code" in the generic git sense. No spec-repo issue proposes a
monorepo-layout or branch-topology convention — placement debate lives only in
unofficial guides.

The nearest non-OKF analogues, which together bracket the `overdeck-state`
design:

| System | What's on the branch/ref | Relation to overdeck-state |
| --- | --- | --- |
| **gh-pages** orphan branches | Generated docs/reports sharing no history with source | The original "disjoint content, same repo" rationale; same known cons (invisible from the default branch, meaningless cross-diffs) |
| **[DiffMem](https://github.com/Growth-Kinetics/DiffMem)** | Per-user agent memory on orphan branches `user/<id>`, checked out via worktrees | **Closest published analog** — orphan branch + dedicated worktree, async push, markdown state files; applied to conversational memory, not project knowledge |
| **Gerrit [NoteDb](https://gerrit-review.googlesource.com/Documentation/note-db.html)** | Review metadata as commit DAGs under `refs/changes/*/meta` in the code repo | Strongest industrial validation of "canonical tool-owned metadata in the code repo's refs, single tool as write door" — the same auditability / travels-with-the-repo argument |
| **[git-annex](https://git-annex.branchable.com/how_it_works/)** | Location-tracking metadata on a `git-annex` branch in every clone | Shows a shared always-syncing state branch works only if the format is engineered for automatic merge (append-only + union merge); overdeck-state instead serializes writes through the single write door |
| **[beads](https://github.com/steveyegge/beads)** `beads-sync` branch | Issue JSONL committed by a daemon to a dedicated branch (introduced because protected main branches rejected state pushes) | Essentially our design, arrived at by necessity; its community backlash (hooks, invasiveness, worktree sync bugs) hit exactly the failure modes overdeck-state's out-of-tree worktree + write door avoid. Beads later migrated to **Dolt** — a signal that git-file state stops scaling at high agent write volume |
| **[git-appraise](https://github.com/google/git-appraise)** / **[git-bug](https://github.com/git-bug/git-bug)** | Reviews/issues as objects under custom refs (`refs/notes/devtools/*`, `refs/bugs/*`), CRDT/union-merged | Machine-owned state planes in refs, solving concurrent writes by merge-engineering rather than a write door |

**Assessment:** `overdeck-state` sits at the intersection of three proven
patterns (gh-pages disjoint-content orphan branches, NoteDb's tool-owned
metadata refs, git-annex's always-present state branch) while avoiding the two
documented failure modes of the space — shared-branch merge conflicts (solved
by the single write door) and contributor-workflow invasiveness (solved by the
out-of-tree worktree at `${OVERDECK_HOME}/state/<project>/`). An
overdeck-state-style branch for the *knowledge* bundle would be a novel pattern
in the OKF ecosystem. It's arguably spec-conformant ("a git repository" with a
nonstandard ref) but trades away the thing our current design deliberately
bought: the companion repo carries its **own CI conformance gate and PR review
surface**, which a never-merging orphan branch cannot have (branch protection,
required checks, and PR review all assume mergeable branches). Knowledge wants
human review; pipeline state wants a mechanical write door. The two-store split
(knowledge = PR-gated sibling repo, state = write-door orphan branch) matches
that difference and should stand.

## 5. How the ecosystem generates and reviews knowledge

- **Supervised ingestion + PR-gated writes** — supachai-j starter: extraction
  is "a quality gate, not a background job" (agent proposes 5–15 claims, human
  approves); MCP `okf_propose_change` does branch + PR, never direct-to-main;
  opt-in `OKF_WRITE_MODE=lease` for high write contention. Same shape as our
  workflow.
- **LLM auditor as advisory reviewer** — theesfeld's `okf-auditor.md`: read-only
  subagent, fetches the live spec first, binary conformance + advisory quality
  checks, never rewrites files. We deferred this (PAN-2066 #5) and made the
  merge gate deterministic instead.
- **Auto-generation + scheduled PR bot** — langchain-ai/openwiki: synthesizes
  the wiki from the codebase, then a daily GitHub Action opens a refresh PR.
- **CI linters/validators** — okf-lint, okflint, W4G1/okf (pure Rust),
  rakibtg/okf-skill; community wants an official `validate` subcommand
  ([knowledge-catalog #125](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/125)).
- **Learning loops** — Google's own ConversationLearner (cross-conversation
  recurrence mining with human-in-the-loop proposal review) is the upstream
  cousin of our `study`/`retro` loops.

## 6. Upstream proposals worth tracking

From the spec repo's issues/discussions (all open unless noted):

- **Epistemics/lifecycle:** typed relationships `supersedes`/`contested_by`
  ([#148](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/148),
  [#195](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/195)),
  graded confidence ([#151](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/151)),
  provenance/integrity ([#140](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/140)),
  freshness/contradiction maintenance signals ([#158](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/158)).
- **Identity/linking:** stable IDs instead of path-as-identity
  ([#120](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/120)),
  wikilinks ([#176](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/176)),
  cross-bundle reference registry ([#175](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/175)).
- **Ergonomics:** `.okfignore` ([#190](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/190)),
  `durability: durable|volatile` for compaction ([#172](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/172)),
  token-budget-aware assembly ([#139](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/139)) —
  this last one overlaps our `/okf extract` ranked/budgeted/cited design and is
  worth a comment upstream.
- **Governance:** KCP's production report naming OKF's three deliberately-open
  problems — temporal validity, cross-org trust/signatures, contradiction
  handling ([Discussion #87](https://github.com/GoogleCloudPlatform/knowledge-catalog/discussions/87)).
- Our **okf-embeddings committed-shards standard** has a wild-grown parallel
  (supachai-j's `okf-embed.py` → `wiki/.okf-embed.json`, hybrid BM25+RRF
  search) but no upstream extension proposal exists yet — ours is still novel
  and remains a candidate to propose.

## 7. Internal history (for archaeology)

- **2026-06-25/26** — original design session: read the spec, cloned every
  community skill, locked the companion-repo + `.okf.yml` + deterministic-gate
  thesis, filed [PAN-2066](https://github.com/eltmon/overdeck/issues/2066).
  Nothing was written to disk.
- **2026-07-07/09** — [PAN-2468](https://github.com/eltmon/overdeck/issues/2468):
  re-research (Karpathy wiki loops, embeddings), PRD → 22-item xBRIEF,
  implemented by a gpt-5.5 codex work agent, merged via PR #2488. Hybrid search
  pulled forward from PAN-2066 into v1 via the okf-embeddings extension.
- **2026-07-14** — first real use: `/okf init` (peer repo + private remote
  chosen) and `/okf study "overdeck front end"` (13 concepts); two skill bugs
  fixed at source.
- **2026-07-14/15** — inkeep/open-knowledge licensing + integration analysis;
  viewer plan written into PAN-2066 as the preferred approach for items
  #1/#2/#4.
- **2026-07-19** — progressive installation, `pan knowledge open`, `/okf open`,
  server-owned lifecycle, origin-isolated proxying, and the dashboard Knowledge
  page implemented. The round-trip spike found YAML source-format churn, so the
  viewer runs against a disposable read-only projection and MCP registration
  stays explicitly opt-in.
