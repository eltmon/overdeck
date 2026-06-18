# Overdeck Remodel — Conversation ↔ Backing-Session-File Model

**Goal:** pin down, with `file:line` evidence, the exact durability model the
operator clarified: a Conversation is **only a pointer** to the session file(s)
that back it; nothing about a conversation goes into git; the backing session
files are **SACRED** (never altered/overwritten/deleted, never in git); and the
conversation **metadata** (name/title/favorites/lineage/binding/model/effort/
harness) is irreplaceable DB-resident data preserved by the **export** (PAN-1937),
not by git.

This is the backing-file companion to
[`conversations-transcripts-audit.md`](conversations-transcripts-audit.md) (which
classifies every column SOURCE-OF-TRUTH / CACHE / DEAD). That audit already
established the conclusion this doc verifies from the file-layer angle:
**`claude_session_id` is the one-directional, unreconstructable pointer; the
transcript is 100% disposable cache; the metadata is the only irreplaceable DB
state.** Here we add: where each harness's file lives, how a conversation
resolves to it, and a write-side audit proving the Transcript layer is read-only.

## Glossary

- **Backing session file (transcript)** — the harness-owned JSONL the coding
  agent appends to as the conversation runs. Claude Code, pi, codex, and
  kimi-via-CLIProxy each use a different on-disk shape. **Sacred:** Overdeck
  must read these but never mutate or delete them, and they are never committed
  to git (they live under `~/.claude/` and `~/.panopticon/agents/`, both outside
  any repo).
- **Pointer** — the field(s) on a `conversations` row that locate the backing
  file. The canonical pointer is `claude_session_id` (claude-code); for pi/codex
  the locator is the conversation's `tmux_session` (= agent id) + `harness`,
  which name the per-agent directory the harness writes into.
- **Metadata** — Overdeck-authored intent that exists **only** in the DB row
  (or the `favorites` table): `name`, `title`/`title_source`, `cwd`/`issue_id`
  binding, `model`/`effort`/`harness`, `archived_at`, lineage edges, favorites.
  Not in the JSONL, not in git → the PAN-1937 export target.
- **Resolver** — a function that turns a conversation/agent into an absolute
  backing-file path. There are three; their harness-awareness differs (§2.4).

---

## 1. The pointer model — which fields point to the backing file

### 1.1 Schema columns (`src/lib/database/schema.ts`, `conversations` CREATE TABLE)

| Column | Role as a pointer | Evidence |
| --- | --- | --- |
| `claude_session_id` | **THE canonical pointer.** Claude Code session UUID; the JSONL filename **is** this UUID. Combined with `cwd` it deterministically yields the file path. Immutable for the conversation's life. | `schema.ts` `claude_session_id TEXT -- Claude Code session UUID. Immutable for the lifetime of the conversation.` |
| `session_file` | **`@deprecated` (PAN-451)** legacy absolute path to the claude JSONL. Kept only for legacy rows; superseded by `claude_session_id`. Still read as a correlator candidate. | `schema.ts` `session_file TEXT -- @deprecated … use claude_session_id`; `correlator.ts:51` |
| `cwd` | Pointer **input**, not a pointer itself. Encoded into the claude project dir name (`encodeClaudeProjectDir`) to build the path. | `paths.ts:230 sessionFilePath(cwd, sessionId)` |
| `tmux_session` | **The pi/codex pointer.** For non-claude harnesses there is no session UUID column — the conversation resolves its file from the per-agent directory keyed by `tmux_session` (= agent id). | `conversations.ts:756,761` (`resolvePiSessionFile(conv.tmuxSession)` / `resolveCodexRolloutPath(conv.tmuxSession)`) |
| `harness` | Pointer **discriminator.** Selects which resolver/file-shape applies (claude-code vs pi vs codex). | `conversations.ts:755,760` |

There is **no** `jsonl_path`, `message_count`, `models_used`, `last_message_at`,
or `duration_seconds` column on `conversations` (the audit's "phantom columns"
finding) — `jsonl_path` is a column on `discovered_sessions` (the Transcript
index), surfaced only via the LEFT JOIN. So `conversations` stores a *pointer*,
not a copy of the transcript or its derived facts.

### 1.2 How the backing file is located from `claude_session_id`

`src/lib/paths.ts:220-233`:

```ts
export function encodeClaudeProjectDir(cwdPath: string): string {
  return cwdPath.replace(/[^a-zA-Z0-9-]/g, '-');           // /home/eltmon/Projects → -home-eltmon-Projects
}
export function sessionFilePath(cwd: string, sessionId: string): string {
  const encodedCwd = encodeClaudeProjectDir(cwd);
  return join(homedir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
}
```

So the claude backing file is **deterministic**: `cwd` + `claude_session_id` →
`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. The pointer is *one-directional*:
the JSONL filename is the UUID, but nothing inside the JSONL names the
conversation back — lose `claude_session_id` and the link is unreconstructable
(this is why the audit marks it the single most important EXPORT field).

### 1.3 The correlator — the reverse link (transcript → conversation)

`src/lib/conversations/correlator.ts:36-65` reconstructs the *managed* flag in
the other direction, but only as **cache**: it reads `(name, cwd, session_file,
claude_session_id, issue_id)` from `conversations`, builds candidate paths
(`session_file`, and `sessionFilePath(cwd, claude_session_id)` at line 52), and
tags any discovered JSONL whose path matches as `panopticonManaged`. It also
falls back to matching `cost_events.session_id`. The correlator **depends on**
the pointer columns; it does not replace them.

---

## 2. Per-harness backing-file map

### 2.1 Claude Code

- **Location:** `~/.claude/projects/<encoded-cwd>/<claude_session_id>.jsonl`.
- **Resolve from conversation:** `conv.claudeSessionId` → `sessionFilePath(conv.cwd, conv.claudeSessionId)` (`conversations.ts:763-764`), with a directory-scan fallback `findClaudeProjectSessionFile` (`transcript-path.ts:29-42`) for when the cwd-encoding doesn't match.
- **Parser:** the default `parseConversationMessages` path (claude JSONL schema).

### 2.2 pi (and kimi-k2.* via CLIProxy)

- **Location:** under the per-agent dir `~/.panopticon/agents/<agentId>/`. Pi writes the transcript as `<iso-timestamp>_<session-id>.jsonl` in **either** the `sessions/` subdir (**conversations**) **or** the **agent-dir root** (**work agents**, PAN-1908). Sibling files `cost-events.jsonl` / `activity.jsonl` in the same dir are **not** transcripts.
- **Resolve from conversation:** `conv.harness === 'pi'` → `resolvePiSessionFile(conv.tmuxSession)` (`conversations.ts:755-756`), which globs `~/.panopticon/agents/<tmux>/sessions/` and returns the newest `.jsonl` (`conversations.ts:774-786`).
- **Resolve from agent (work/pipeline):** `resolvePiSessionPath(agentId)` (`jsonl-resolver.ts:204-229`) — checks **both** `<agentDir>/sessions/` and `<agentDir>` root, excludes `cost-events.jsonl`/`activity.jsonl`, returns freshest by mtime.
- **kimi note:** kimi-k2.* routes through pi (provider-default routing), so kimi conversations are pi-shaped JSONL in the pi locations above — there is no separate "kimi" file shape. (No kimi/CLIProxy-specific transcript directory exists in the code; the CLIProxy is a request-time bridge, not a transcript writer.)

### 2.3 codex

- **Location:** per-agent `CODEX_HOME` at `~/.panopticon/agents/<agentId>/codex-home/sessions/<YYYY>/<MM>/<DD>/rollout-<uuid>-<threadId>.jsonl` (OpenAI rollout schema). The resume pointer is the **thread-id**, persisted to `~/.panopticon/agents/<agentId>/codex-thread-id`.
- **Resolve from conversation:** `conv.harness === 'codex'` → `resolveCodexRolloutPath(conv.tmuxSession)` (`conversations.ts:760-761`).
- **Resolve from agent:** `resolveCodexRolloutPath(agentId)` (`jsonl-resolver.ts:178-195`) — fast path reads `codex-thread-id` → `findRolloutPath`; lazy fallback `findLatestRollout(codexHome)` (codex writes the rollout only on the first turn, so a spawn-time capture can miss it).

### 2.4 The "three pi-aware surfaces" (PAN-1908) — and a fourth claude-only one

Rendering a pi/codex transcript requires every surface that touches a session
file to be harness-aware. The code has **three harness-aware** surfaces plus
**one claude-only** resolver that must stay off the pi/codex path:

| # | Surface | File:line | Harness-aware? |
| --- | --- | --- | --- |
| 1 | **Session-trees / agent resolver** `resolveJsonlPath(agentId, …)` | `jsonl-resolver.ts:238-261` — dispatches on `state.json` `harness`: codex→rollout, pi→pi-session, else claude | ✅ |
| 2 | **Parser dispatch** `isCodexSessionFile` / `isPiSessionFile` → `parseCodexConversationMessages` / `parsePiConversationMessages` / claude parser | `conversations.ts:541-547` (`getCachedMessages`); detectors `isPiSessionFile` `pi-conversation-parser.ts:34-43`, `isCodexSessionFile` `conversations.ts:794-796` | ✅ (codex tested **before** pi — a codex path also matches the pi substring) |
| 3 | **Conversation `/messages` resolver** `resolveSessionFile(conv)` | `conversations.ts:751-767` — pi→`resolvePiSessionFile`, codex→`resolveCodexRolloutPath`, else claude `sessionFilePath` | ✅ |
| 4 | **`resolveConversationTranscript(cwd, claudeSessionId)`** | `transcript-path.ts:14-27` — **claude-only**, no harness branch | ⚠️ claude-only |

**Surface #4 is currently safe** because its **only** non-test caller is the
`pan conversations jsonl` CLI command (`src/cli/commands/conversations/jsonl.ts:27`),
which passes `conversation.claudeSessionId` and is a claude-only affordance. It
is **not** on the pi/codex `/messages` path. *Design risk to carry forward:* a
claude-only resolver named `resolveConversationTranscript` is a trap — any future
caller that routes a pi/codex conversation through it will resolve a non-existent
`~/.claude/projects/...` path and render an empty transcript. The corrected
design (§5) folds all transcript resolution into one harness-aware resolver.

---

## 3. Sacred-file enforcement — write-side audit

**Method:** two passes. (1) Path-anchored: grep all of `src/` (non-test) for
`writeFile | appendFile | createWriteStream | copyFile | rename | unlink | rmSync |
rm | truncate` whose target line names a session file (`.jsonl`,
`~/.claude/projects`, `sessions/`, `sessionFile`/`sessionFilePath`, `rollout`).
(2) Resolver-anchored (to catch a write through a generically-named variable): a
full `src/` write/delete sweep filtered down to candidates, and a direct read of
`smart-compaction.ts` (the one compaction-path module the path-anchored grep
didn't surface). The resolver-anchored sweep found **no additional** session-file
writers — every other write targets PID files, settings, traefik/dns config, TTS
state, sync targets, or `.beads`/`.pan` JSON, none of which resolve a transcript
path; and `smart-compaction.ts` imports only `readFile`/`rm` (the `rm` is a
`mkdtemp` cleanup, not the source) and **returns summary text, never appending to
the source** (`smart-compaction.ts:3,82` read-only; `generateSmartSummary` →
`{ summary }`). The harness appending to **its own** JSONL as the agent runs is
the normal flow and out of scope — we hunt **Overdeck** code mutating an
**existing** backing file in place.

Six hits. Adjudication:

| # | Site | Target | Verdict |
| --- | --- | --- | --- |
| 1 | `summary-fork.ts:649` `copySessionFromCompactBoundary` → `writeFile(destPath, …)` | **NEW** freshly-reserved `randomUUID()` file (`reserveSummaryForkSession` → `randomUUID()`, `summary-fork.ts:562,667`). Source read read-only via `readFile(sourcePath)`. | ✅ **Compliant — by design.** Forks create a fresh session file from a compact boundary; source is never touched. This is exactly PAN-1781's "fresh-session seeding, never boundary-JSON tweaks." |
| 2 | `session-format-converter.ts:223,248,288` `writeFile(targetSessionFile, …)` | **NEW** `randomUUID()` files (codex rollout / pi session / claude session) for **harness switching**. Source read read-only (`readFile(opts.sourceSessionFile)`, line 190). | ✅ **Compliant.** Creates a new transcript in the target harness's shape; source preserved. |
| 3 | `deacon.ts:5617` `rmSync(sessionFile)` | **NOT a transcript.** `sessionFile` here = `~/.panopticon/agents/<id>/session.id` — a tiny **pointer file** holding the resume UUID, deleted on signature-corruption recovery so `--resume` won't reattach the corrupted session. The sacred JSONL is untouched. | ✅ **Compliant** (misleading variable name). |
| 4 | `teardown-workspace.ts:302` `appendFile(projJsonl, …)` | **NOT a transcript.** `projJsonl` = `.beads/issues.jsonl` (the bd issue tracker), merging workspace beads into the project root. Unrelated to conversation transcripts. | ✅ **Out of scope.** |
| 5 | **`conversation-compaction.ts:164`** `appendFile(sessionFile, …)` | **The LIVE existing claude backing JSONL.** Appends a Overdeck-authored `compact_boundary` system entry + an `isCompactSummary` user message **in place** into the conversation's own `~/.claude/projects/**/<uuid>.jsonl`. | ⚠️ **IN-PLACE MUTATION of a backing file** — see below. |

### 3.1 The one in-place mutation — `conversation-compaction.ts:164` (FLAGGED)

`compactConversationNative(sessionFile)` → `doCompact` → `appendFile(sessionFile,
…)` writes two new JSONL lines (a `subtype:'compact_boundary'` system record and
an `isCompactSummary` user record) **directly onto the existing claude session
file** (`conversation-compaction.ts:131-164`). The `sessionFile` passed in is the
conversation's live transcript, resolved via the harness-aware `resolveSessionFile`
at the call site (`conversations.ts:990 compactSessionFile = await resolveSessionFile(conv)`,
and the pre-respawn path `conversations.ts:2954`).

This is an **append, not a truncate/overwrite/delete** — existing bytes are
preserved and the file remains a valid claude transcript — but it is still
Overdeck **writing into a backing file it does not own**, which the operator's
sacred-file model says must never happen.

**Two mitigations already in the code:**

1. **Hard claude-only gate.** The manual-`/compact` interception runs only when
   `(conv.harness ?? 'claude-code') === 'claude-code'` (`conversations.ts:989`),
   with an explicit P0 comment: *"running it on a Pi conversation would corrupt
   the Pi transcript (P0, 2026-05-14)."* So pi/codex backing files are never
   appended to by this path. The pre-respawn variant is similarly behind the
   `summaryFork` background-feature toggle (`conversation-compaction.ts:182`).
2. **Append-only.** No `truncate`, no `unlink`, no rewrite of prior bytes.

**Tension to resolve in the remodel.** This append-in-place predates / coexists
with the **fork** approach (`summary-fork.ts`, `session-format-converter.ts`),
which Overdeck's own memory (PAN-1781: *"`claude --resume` bypasses injected
compact boundaries ~50% → fresh-session seeding, never boundary-JSON tweaks"*)
records as the **correct** pattern — write a NEW session file, never tweak the
boundary JSON of the live one. The corrected sacred-file model (§5) says the
Conversation/Transcript layer must be **strictly read-only** over backing files;
under that rule `compactConversationNative`'s in-place append is the lone
violator and should be converted to the fork pattern (new session file) so that
*no* code path writes into an existing transcript. **Flagging loudly for the
remodel; not changing behavior in this investigation.**

### 3.2 Net finding

- **Delete/truncate/overwrite of an existing backing transcript: NONE.** (#3 deletes a *pointer* file, not a transcript; #1/#2 write fresh UUID files.)
- **In-place append to an existing backing transcript: ONE** — `conversation-compaction.ts:164`, claude-only-gated, append-only, and at odds with the fork pattern the codebase otherwise prefers. **This is the single site the remodel must address to make the Transcript layer truly read-only.**

---

## 4. Where conversation metadata lives + the export (PAN-1937)

### 4.1 Metadata is DB-resident only

The irreplaceable conversation metadata lives **only** in the local SQLite
`conversations` table (`~/.panopticon/panopticon.db`) plus the `favorites` table —
nowhere in the JSONL (the transcript never names the conversation, its title, its
favorite status, its lineage) and nowhere in git. **Verified (not merely
asserted):** a grep for any conversation `name`/`title`/`favorite`/lineage write
to a **tracked** `.pan/` path (`.pan/continues|specs|drafts|records`) returns
**nothing** — conversation DB writes go to SQLite via prepared statements (not
files), and the only file a conversation writes is the handoff doc, which lands in
`~/.panopticon/handoffs/` (`getHandoffsDir`, `paths.ts:26` — outside any repo) with
the row holding only a *pointer* (`handoff_doc_path`) to it. The `~/.claude` and
`~/.panopticon/agents` trees are likewise outside any repo. The
conversations-transcripts audit enumerates the exact 14-field
EXPORT set + `favorites`; it is reproduced here as the export contract:

`name`, `cwd`, `issue_id`, `created_at`, **`claude_session_id`** (the
one-directional pointer — the critical one), `title` *(manual only)*,
`title_source`, `model`, `effort`, `harness`, `archived_at`, and lineage edges
`handoff_doc_path`, `handoff_target_conv_id`, `cleared_to_conv_id` (lineage edges
exported by resolving the target/sibling conversation **`name`**, since `id` is
autoincrement and not portable). Plus all `favorites` rows of `type='conversation'`
(keyed by conversation `name`).

For pi/codex conversations the metadata set is the same **minus** a meaningful
`claude_session_id` — their pointer is `tmux_session` + `harness`, so the export
for those rows must carry `harness` + the per-agent locator instead of (or
alongside) the claude UUID. *(Recommendation: export the resolved
harness-appropriate session identifier, not just `claude_session_id`, so a pi or
codex conversation can be relinked after a wipe.)*

### 4.2 The export is NOT built yet

Verified: there is **no** export command, endpoint, or function. The
`src/cli/commands/conversations/` directory has `cost / current / embed / enrich /
format / index / jsonl / list / scan / search / show` — **no `export`**. Grep for
`exportConversations` / `conversations export` / `dumpConversations` returns only
the audit/design docs, never source. PAN-1937 exists today as **design only**:

- [`conversations-transcripts-audit.md`](conversations-transcripts-audit.md) §"The export target" — the 14-field set.
- [`../END-STATE.md`](../END-STATE.md) §5.2 "The durable-home call" — recommends making the export a **git `.pan/records`-style durable artifact** (mirroring the Issue record) so the metadata travels across machines, leaving the DB purely disposable. *Operator's call: git-record artifact vs. keep `conversations` as the one DB-as-truth exception.*
- [`../OVERDECK-REMODEL-KICKOFF.md`](../OVERDECK-REMODEL-KICKOFF.md):28 — names `conversations` + `favorites` as the only data worth preserving, "see PAN-1937."

**What the export must capture (when built):** the 14 metadata fields + favorites
above, written to a durable home **outside** the disposable DB. Two candidate
targets named in the design: (a) a git `.pan/records`-style per-conversation
artifact (recommended — travels across machines, matches the Issue-record
pattern), or (b) a single conversations export file under `~/.panopticon/...`.
The export's job is "preserve the pointer + the authored intent," **not** the
transcript (sacred, on disk, never in git) and **not** the derived facts
(rebuildable cache from JSONL/tmux/cost_events).

---

## 5. Corrected Conversations + Transcript domain design

The clarified model, expressed as the target architecture:

### 5.1 Conversation = DB metadata + per-harness pointer(s) to sacred files

A `Conversation` is a **thin durable metadata record** plus a **pointer** to one
or more sacred backing files:

- **Durable metadata (DB-resident, export target, never in git):** the 14 fields
  + favorites in §4.1. This is the *only* irreplaceable state.
- **Pointer:** `claude_session_id` (claude-code) **or** `tmux_session` + `harness`
  (pi/codex), resolving to a sacred backing file via §2's per-harness map. A
  conversation **may back to more than one file type** over its life: a harness
  switch via `session-format-converter.ts` creates a **new** file in the new
  harness's shape, updates the conversation's `harness`/pointer fields to the new
  sacred file, and **leaves the old file intact** (never deleted). **Caveat on
  current state:** today's resolvers dispatch on the single current `conv.harness`
  and return **one** file (`resolveSessionFile` `conversations.ts:751-767`), so a
  pre-switch transcript is no longer surfaced after a switch even though it still
  exists on disk. "Back to more than one file" is therefore the **design target**
  (the files are all preserved) — the *resolver* surfacing multiple backing files
  per conversation is not built; the remodel's single resolver should expose the
  full set, not just the current-harness file.
- **Derived facts** (`message_count`, `models`, tokens, cost, first/last ts) are
  **not stored on the conversation** — they are computed by the Transcript layer
  and surfaced via the JOIN to `discovered_sessions`. Pure cache.

### 5.2 The Conversation writer never mutates a backing file

The Conversation domain writes **only** to the DB (metadata, status, lineage) and
**only** creates **new** session files (forks, harness switches) — it never opens
an existing backing transcript for write/append/truncate/delete. Today this holds
for every path **except** `compactConversationNative` (`conversation-compaction.ts:164`),
which the remodel should convert to the fork pattern (new session file) so the
invariant is total and mechanically enforceable. Backing files are append-only by
their owning harness; Overdeck's only legitimate write is *creating a new file*.

### 5.3 The Transcript service is read-only across harness shapes

One Transcript service **reads** backing files (never writes) and computes all
derived facts, dispatching on harness shape:

- **One harness-aware resolver** (collapse the three+one resolvers in §2.4 into a
  single entry point) maps a conversation/agent → its sacred backing file(s),
  branching claude / pi / codex. Retire or fold the claude-only
  `resolveConversationTranscript` so no caller can accidentally route a pi/codex
  conversation through a claude-only path.
- **One parser dispatch** (`isCodexSessionFile` → codex, `isPiSessionFile` → pi,
  else claude) emits a uniform `ParseResult` regardless of on-disk shape
  (`conversations.ts:541-547`).
- **The Transcript index** (`discovered_sessions`, the scanner/correlator) is the
  single place JSONL-derived facts are computed once; it is **100% rebuildable
  cache** (audit §2). The Conversation references it by `claude_session_id`; the
  Agent by `agents.session_id`.

### 5.4 Durability summary

| Layer | Home | In git? | On wipe |
| --- | --- | --- | --- |
| **Backing transcript** (claude/pi/codex JSONL) | `~/.claude/projects/…`, `~/.panopticon/agents/<id>/[sessions/]…` | **No** (sacred, on disk) | **Survives** — never touched by a DB wipe |
| **Conversation metadata** (14 fields + favorites) | `conversations` / `favorites` in `~/.panopticon/panopticon.db` | **No** | **LOST unless exported** → PAN-1937 export (git `.pan/records` artifact recommended) |
| **Transcript-derived facts** (`discovered_sessions`, FTS, embeddings) | same DB | **No** | **Rebuilt** by the scan from the (surviving) backing files |

The headline: **only the metadata needs the export.** The transcript is sacred
and self-preserving on disk; the derived facts rebuild from it. The export's sole
job is to carry the irreplaceable pointer + authored intent over a wipe and
across machines.

---

## Appendix — primary evidence index

- Pointer columns: `src/lib/database/schema.ts` (conversations CREATE TABLE — `claude_session_id`, `session_file @deprecated`, `cwd`, `tmux_session`, `harness`)
- Claude path builder: `src/lib/paths.ts:220-233` (`encodeClaudeProjectDir`, `sessionFilePath`)
- Claude-only resolver (surface #4): `src/lib/conversations/transcript-path.ts:14-42`; sole caller `src/cli/commands/conversations/jsonl.ts:27`
- Conversation `/messages` resolver (surface #3): `src/dashboard/server/routes/conversations.ts:751-786`
- Agent/session-tree resolver (surface #1): `src/dashboard/server/routes/jsonl-resolver.ts:178-261` (`resolveCodexRolloutPath`, `resolvePiSessionPath`, `resolveJsonlPath` dispatch)
- Parser dispatch (surface #2): `src/dashboard/server/routes/conversations.ts:541-547`; `isPiSessionFile` `src/dashboard/server/services/pi-conversation-parser.ts:34-43`; `isCodexSessionFile` `conversations.ts:794-796`
- Correlator (reverse link, cache): `src/lib/conversations/correlator.ts:36-65`
- Write-side audit: `summary-fork.ts:559-572,627-649`; `session-format-converter.ts:190-289`; `deacon.ts:5615-5617`; `teardown-workspace.ts:292-302`; **`conversation-compaction.ts:131-164`** (the flagged in-place append); claude-only gate `conversations.ts:989`
- Export status: `src/cli/commands/conversations/` (no `export`); design in `conversations-transcripts-audit.md`, `END-STATE.md` §5, `OVERDECK-REMODEL-KICKOFF.md:28`
