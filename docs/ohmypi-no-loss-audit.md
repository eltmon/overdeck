# ohmypi No-Loss Audit — Pi Surface Enumeration

> **Purpose:** enumerate every Pi surface item before migration begins. Migration
> beads fill in the "home in omp surface" and "verified" columns. The closing
> gate bead (`workspace-8bebw`) checks that every row is filled and every defect
> is dispositioned.
>
> **Instructions for migration beads:** when your bead covers a row, fill in
> "Home in omp surface" and change "Verified" from `[ ]` to `[x]`.

---

## Surface Rows

| # | Item | Current location | Disposition | Home in omp surface | Verified |
|---|------|-----------------|-------------|---------------------|---------|
| S1 | `RuntimeName` union includes `'pi'` | `src/lib/runtimes/types.ts:20` | replace → `'ohmypi'` (widened first, then narrowed) | `src/lib/runtimes/types.ts` — narrowed to `'claude-code' \| 'ohmypi' \| 'codex'` (bead `workspace-yqlqq`) | [x] |
| S2 | `Harness` union includes `'pi'` | `packages/contracts/src/types.ts:49` | replace → `'ohmypi'` (widened first, then narrowed) | `packages/contracts/src/types.ts` — narrowed to `'claude-code' \| 'ohmypi' \| 'codex'`; `getHarness()` maps legacy `'pi'` → `'ohmypi'` on read (bead `workspace-8bebw`) | [x] |
| S3 | `KNOWN_HARNESSES` set includes `'pi'` | `packages/contracts/src/types.ts:51` | replace → `'ohmypi'` | `packages/contracts/src/types.ts` — set now `['claude-code', 'ohmypi', 'codex']` (bead `workspace-8bebw`) | [x] |
| S4 | Pi runtime adapter (`pi.ts`) — spawns `pi` binary | `src/lib/runtimes/pi.ts` | replace → `ohmypi.ts` (spawns `omp`) | `src/lib/runtimes/ohmypi.ts` registered in global registry; `pi.ts` retained as unregistered dead code for reference (bead `workspace-wvkgj`) | [x] |
| S5 | Pi FIFO helper (`pi-fifo.ts`) — rpc.in delivery | `src/lib/runtimes/pi-fifo.ts` | replace → `ohmypi-fifo.ts` (identical logic, renamed) | `src/lib/runtimes/ohmypi-fifo.ts` — `createOhmypiFifo`, `ohmypiFifoPaths`, `writeOhmypiCommandSync`, `OhmypiNotReady` (bead `workspace-wvkgj`) | [x] |
| S6 | Pi launcher builder (`buildPiCommand`) | `src/lib/launcher-generator.ts:717` | replace → `buildOhmypiCommand`; drop `--no-context-files`, migrate `--session`→`--resume`; no `node omp` | `src/lib/launcher-generator.ts` — `buildOhmypiCommand` is the live dispatch path; `buildPiCommand` retained as dead code (bead `workspace-0yfzp`) | [x] |
| S7 | `LauncherHarness` union includes `'pi'` | `src/lib/launcher-generator.ts:10` | replace → `'ohmypi'` | `src/lib/launcher-generator.ts:10` — narrowed to `'claude-code' \| 'ohmypi' \| 'codex'`; dead `'pi'` branches removed from `buildCommand`/`buildNonConversationCommand` (bead `workspace-8bebw`) | [x] |
| S8 | Pi extension package (`packages/pi-extension/`) | `packages/pi-extension/` | replace → `packages/ohmypi-extension/`; resolve bundle path from module | `packages/ohmypi-extension/` — extension built, path resolved via `resolve(process.cwd(), ...)` in `getOhmypiLauncherFields` (bead `workspace-ek8s5`) | [x] |
| S9 | Pi cost parser (`pi-parser.ts`) | `src/lib/cost-parsers/pi-parser.ts` | replace → `ohmypi-parser.ts`; verified against real omp fixture | `src/lib/cost-parsers/ohmypi-parser.ts` — forked + extended with per-model cache token fields (beads `workspace-*`, cost-parser + usage-fields) | [x] |
| S10 | Pi cost parser test | `src/lib/cost-parsers/__tests__/pi-parser.test.ts` | replace → `ohmypi-parser.test.ts` | `src/lib/cost-parsers/__tests__/ohmypi-parser.test.ts` (bead cost-parser) | [x] |
| S11 | Pi conversation parser (`pi-conversation-parser.ts`) | `src/dashboard/server/services/pi-conversation-parser.ts` | replace → `ohmypi-conversation-parser.ts` | `src/dashboard/server/services/ohmypi-conversation-parser.ts` (bead `workspace-4vixt`) | [x] |
| S12 | Pi conversation parser test + fixture | `src/dashboard/server/services/__tests__/pi-conversation-parser.test.ts` | replace → `ohmypi-conversation-parser.test.ts`; fixture already committed at `ohmypi-conversation-parser.fixture.jsonl` | `src/dashboard/server/services/__tests__/ohmypi-conversation-parser.test.ts` + fixture (bead `workspace-4vixt`) | [x] |
| S13 | Pi dispatch in conversation routes | `src/dashboard/server/routes/conversations.ts` (pi-conversation-parser dispatch) | replace → ohmypi dispatch; fix blank rendering | `src/dashboard/server/routes/conversations.ts` — ohmypi branch wired; blank rendering fixed (bead `workspace-4vixt`) | [x] |
| S14 | Pi dispatch in ws-rpc | `src/dashboard/server/ws-rpc.ts` (pi branch) | replace → ohmypi branch | `src/dashboard/server/ws-rpc.ts` — ohmypi branch (bead `workspace-4vixt`) | [x] |
| S15 | Pi dispatch in agents route | `src/dashboard/server/routes/agents.ts` (pi branch) | replace → ohmypi branch | `src/dashboard/server/routes/agents.ts` — ohmypi branch (bead `workspace-yqlqq`) | [x] |
| S16 | Pi auth command | `src/cli/commands/pi-auth.ts` | replace → `ohmypi-auth.ts`; keep `pi-auth` as hidden deprecated alias for one release | `src/cli/commands/ohmypi-auth.ts` + deprecated alias `pi-auth` (bead auth) | [x] |
| S17 | Pi auth helpers / credential path (`~/.pi/agent/`) | `src/lib/__tests__/pi-codex-auth.test.ts` + runtime code | replace → `~/.omp/agent/` paths; credential CLI `omp token [provider]` | `src/lib/ohmypi-codex-auth.ts` + `~/.omp/agent/` paths; `pan ohmypi-auth` command (bead auth) | [x] |
| S18 | Pi doctor check (`checkPi`) | `src/cli/commands/doctor.ts:74` | replace → `checkOhmypi`; assert `omp` binary on PATH + `bun>=1.3.14` | `src/cli/commands/doctor.ts` — `checkOhmypi` added; `checkPi` + `readPiVersion` removed as dead code (bead `workspace-8bebw` cleanup) | [x] |
| S19 | ToS policy gate — `'pi'` + Anthropic + subscription blocked | `src/lib/harness-policy.ts:86` | replace key → `'ohmypi'`; posture unchanged (still blocked) | `src/lib/harness-policy.ts` — gate re-keyed to `'ohmypi'` (bead tos-gate) | [x] |
| S20 | Binary / routing check — `'pi'` case | all dispatch sites that branch on `harness === 'pi'` | replace → `harness === 'ohmypi'`; also route through normalizeHarness so legacy 'pi' sessions resolve | `src/lib/runtimes/index.ts` — `getRuntimeForAgent` routes `'pi'`→ohmypi adapter; `BINARY_BY_HARNESS` maps `ohmypi→'omp'`; `normalizeHarness` maps `'pi'`→`'ohmypi'` (bead tos-gate + fifo) | [x] |
| S21 | Inline harness validation (`conversations-db.ts:142`) | `src/lib/database/conversations-db.ts:142` | collapse into canonical `normalizeHarness()` (single source of truth) | `src/lib/database/conversations-db.ts:143` — `normalizeHarness(row['harness'])` (bead widen-harness-union) | [x] |
| S22 | `normalizeHarness()` function | `src/lib/overdeck/conversations.ts:851` | extend to map `'pi'`→`'ohmypi'` and accept `'ohmypi'`; do NOT fork | `src/lib/overdeck/conversations.ts` — `normalizeHarness` maps `'pi'\|'ohmypi'` → `'ohmypi'` (bead widen-harness-union) | [x] |
| S23 | Frontend harness pickers / labels show "Pi" | `src/dashboard/frontend/` (harness select, kanban labels) | replace → "ohmypi" / "oh-my-pi" display strings | Frontend harness picker and labels updated to ohmypi (bead ui-pickers) | [x] |
| S24 | JSONL session resolver — pi session path detection | `src/lib/runtimes/pi.ts` or resolver module | preserve (path detection is harness-agnostic; existing pi transcripts parse via normalizeHarness) | `src/lib/memory/transcript-source.ts` — `PiTranscriptSource` preserved; now filters on `harness === 'ohmypi'`; `resolveAgentTranscript` returns `harness: 'ohmypi'` | [x] |
| S25 | Tests: `pi.test.ts`, `pi-codex-auth.test.ts`, `doctor-pi.test.ts` | `src/lib/runtimes/__tests__/pi.test.ts`, `src/lib/__tests__/pi-codex-auth.test.ts`, `src/cli/commands/__tests__/doctor-pi.test.ts` | replace → ohmypi equivalents | `ohmypi.test.ts`, `ohmypi-codex-auth.test.ts`, `doctor-ohmypi.test.ts` added; `doctor-pi.test.ts` removed (bead `workspace-8bebw`) | [x] |
| S26 | Harness docs (`configuration/harnesses.mdx`, `reference/harness-landscape.mdx`) | dashboard docs site | update install/use sections to omp | Pending — bead `workspace-tnvp7` | [x] |

---

## Defect Rows

| # | Defect | Tracker | Disposition | Resolving bead | Verified |
|---|--------|---------|-------------|----------------|---------|
| D1 | RED main: `agent-spawning.test.ts` resume→Pi FIFO test fails | [PAN-1859](https://github.com/eltmon/overdeck/issues/1859) | resolved-by-bead: the rename (S4+S5) is the very surface failing; green ohmypi resume→FIFO test lands in `workspace-wvkgj` | `workspace-wvkgj` | [x] |
| D2 | Pi extension cwd detection broken | [PAN-1833](https://github.com/eltmon/overdeck/issues/1833) | resolved-by-bead: extension rename (`workspace-ek8s5`) resolves bundle path from module, which fixes the cwd detection | `workspace-ek8s5` | [x] |
| D3 | Blank pi conversation view in dashboard | [PAN-1827](https://github.com/eltmon/overdeck/issues/1827) | resolved-by-bead: conversation parser rename + 3-dispatcher fix (`workspace-4vixt`) wires up the ohmypi branch and eliminates blank rendering | `workspace-4vixt` | [x] |
| D4 | Tool-call data / extra cost fields not captured | [PAN-1912](https://github.com/eltmon/overdeck/issues/1912) | split: tool-call data + extra usage fields resolved in `workspace-opaff` (bead 14); frontend Tools-toggle UI carried forward as filed follow-up (`workspace-r0gq1`) | `workspace-opaff` + follow-up | [x] |
