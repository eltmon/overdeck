# PAN-2444 acceptance evidence

Each acceptance criterion from the xBRIEF with the test, command or record that shows it. Fork tests live in `eltmon/ox` at `de597179542aca4a4815e0b6ab49f75809fa3be7` ([eltmon/ox#1](https://github.com/eltmon/ox/pull/1)); Overdeck tests are on this branch.

## fork-base

- **fork-base.ac1** — Given the fork clone, when `git rev-parse origin/overdeck-base` runs, then it returns the same SHA as `git rev-parse 'v0.19.0^{commit}'`.  
  Evidence: `git rev-parse origin/overdeck-base` = `git rev-parse v0.19.0^{commit}` = `201c0a56650d5a698c391aafca815a8371adbe04`, re-checked on 2026-09-29 after all fork work.
- **fork-base.ac2** — Given the push, when `git ls-remote git@github.com:eltmon/ox.git main` runs, then it returns the SHA recorded under ## Branches before the push (fork main is preserved).  
  Evidence: `git ls-remote git@github.com:eltmon/ox.git main` = `cf00e2123875efe7b0a8e6a729f818eb50fe4ac9`, the SHA recorded under `## Branches` before any push.
- **fork-base.ac3** — Given docs/SAGEOX-FORK.md, when it is read, then it contains the five headings and one verdict line for each of 70e0f37a37, acdf05c9d0 and cf00e21238.  
  Evidence: `docs/SAGEOX-FORK.md` has `## Branches`, `## Contract`, `## Audit of old fork commits` (one verdict line each for `70e0f37a37`, `acdf05c9d0`, `cf00e21238`), `## Changes`, `## Building`.

## fork-no-repo-writes

- **fork-no-repo-writes.ac1** — Given a temp git repo with .sageox/config.json and OX_HOST_MANAGED=1, when `ox agent prime` and `ox agent hook SessionStart` run, then `git status --porcelain` returns empty output.  
  Evidence: eltmon/ox `cmd/ox/host_managed_test.go` `TestHostManaged_PrimeLeavesTheRepoUntouched` and `TestHostManaged_HooksLeaveTheRepoUntouched` (repo initialized by real `ox init`, then stripped; `git status --porcelain --untracked-files=all` empty), with the upstream control `TestHostManaged_UnsetKeepsUpstreamAntiEntropy`.
- **fork-no-repo-writes.ac2** — Given a temp git repo without .sageox/ and OX_HOST_MANAGED=1, when `ox agent prime` runs, then it exits 0 and prints nothing to stdout.  
  Evidence: eltmon/ox `cmd/ox/host_managed_test.go` `TestHostManaged_UninitializedRepoIsSilent` (exit 0, empty output); live: `.pan/drafts/PAN-2444-live-checkpoint.md` section 4.
- **fork-no-repo-writes.ac3** — Given OX_HOST_MANAGED=1 and no ox login credential, when `ox agent prime` runs in an initialized temp repo, then its output contains no 'ox login' text.  
  Evidence: eltmon/ox `cmd/ox/host_managed_test.go` `TestHostManaged_LoggedOutPrimeHasNoLoginInstruction` (JSON prime, `FEATURE_AUTH=true`, credential removed: no `ox login`), control `TestHostManaged_UnsetLoggedOutPrimeAsksForLogin`.
- **fork-no-repo-writes.ac4** — Given OX_HOST_MANAGED unset, when `go test ./cmd/ox/... ./internal/config/...` runs in the fork clone, then it exits 0 (upstream behavior preserved).  
  Evidence: `go test ./cmd/ox/... ./internal/config/... ./internal/daemon/... ./internal/teamconverge/...` passed at `3e3012b`; the whole fork suite `go test ./... -count=1` passed at `de59717` (141 packages ok, exit 0).
- **fork-no-repo-writes.ac5** — Given docs/SAGEOX-FORK.md, when it is read, then ## Changes names the fork commit SHA for this item and the gated write sites.  
  Evidence: `docs/SAGEOX-FORK.md` `## Changes` F2 entry: commit `3e3012b…` and the gated sites (`EnsureOxPrimeMarker`, `ensureClaudeHooks`, `reconcileSkillInventoryIfStale`, teamconverge, autofix).

## fork-network-gate

- **fork-network-gate.ac1** — Given OX_HOST_MANAGED=1, OX_HOST_NETWORK unset and OX_SESSION_PUBLISHING=auto, when ResolveSessionPublishing runs, then it returns mode manual.  
  Evidence: eltmon/ox `internal/config/host_test.go` `TestHostOffline_ForcesManualPublishingAndOffSwitches`: `OX_SESSION_PUBLISHING=auto` → manual, source `host`.
- **fork-network-gate.ac2** — Given OX_HOST_MANAGED=1 and OX_HOST_NETWORK=off, when the telemetry, friction, GitHub sync and cloud-query resolvers run, then each reports disabled.  
  Evidence: Same test (GitHub sync master/PRs/issues disabled, cloud query off); `internal/telemetry/host_test.go` (telemetry off); `internal/daemon/host_test.go` (daemon disabled, daemon telemetry and friction off). The CLI friction path checks `config.HostOffline()` in `cmd/ox/friction.go`.
- **fork-network-gate.ac3** — Given an httptest.Server as SAGEOX_ENDPOINT, a fake login credential and OX_HOST_MANAGED=1 with OX_HOST_NETWORK unset, when prime, hook SessionStart and hook Stop run, then the server records zero requests.  
  Evidence: eltmon/ox `cmd/ox/host_network_test.go` `TestHostOffline_PrimeAndHooksSendNothingAndRecordLocally`: logged in, `SAGEOX_ENDPOINT` = httptest server, prime + hooks SessionStart/UserPromptSubmit/PostToolUse/Stop/SessionEnd → zero requests. See the ledger for the harness limit on the network-on control.
- **fork-network-gate.ac4** — Given OX_HOST_MANAGED=1 and OX_HOST_NETWORK=on, when ResolveSessionPublishing runs with OX_SESSION_PUBLISHING=auto, then it returns auto.  
  Evidence: Same config test: with `OX_HOST_NETWORK=on`, `OX_SESSION_PUBLISHING=auto` → auto from env.
- **fork-network-gate.ac5** — Given docs/SAGEOX-FORK.md, when it is read, then it records the CP-1 outcome as either 'offline recording' or 'recording disabled when network off'.  
  Evidence: `docs/SAGEOX-FORK.md` `### CP-1 outcome (offline recording)`: offline recording, primary branch, with the ledger-clone precondition.

## fork-no-attribution

- **fork-no-attribution.ac1** — Given OX_HOST_MANAGED=1 in an initialized temp repo, when `ox agent prime` runs, then its output contains no 'Co-Authored-By' text and no plan footer.  
  Evidence: eltmon/ox `cmd/ox/host_managed_test.go` `TestHostManaged_PrimeCarriesNoAttribution` (XML and JSON: no `Co-Authored-By`, `Guided by SageOx`, `<attribution>`); control `TestHostManaged_UnsetPrimeCarriesAttribution`; live grep counts 0 in the live checkpoint section 4.
- **fork-no-attribution.ac2** — Given OX_HOST_MANAGED unset, when `go test ./cmd/ox/... -run Attribution` runs in the fork clone, then it exits 0.  
  Evidence: `go test ./cmd/ox/ -run Attribution -count=1` → ok (run at `52b8d66`, again with the full suite at `de59717`).
- **fork-no-attribution.ac3** — Given docs/SAGEOX-FORK.md, when it is read, then ## Changes lists this item's fork commit SHA.  
  Evidence: `docs/SAGEOX-FORK.md` `## Changes` F4 entry lists `52b8d669a1a35b25e14af877ecd161ea78c96567`.

## fork-host-contract

- **fork-host-contract.ac1** — Given the fork build, when `bin/ox host-contract --json` runs, then it exits 0 and `jq -e '.contract=="overdeck-host/1"'` succeeds on its output.  
  Evidence: `bin/ox host-contract --json | jq -e '.contract=="overdeck-host/1"'` printed `true`, exit 0.
- **fork-host-contract.ac2** — Given the JSON output, when parsed, then it has exactly the keys contract, hostManaged, version and commit.  
  Evidence: eltmon/ox `cmd/ox/host_contract_test.go` `TestHostContract_JSONHasTheFourKeys` (exactly contract, hostManaged, version, commit).
- **fork-host-contract.ac3** — Given docs/SAGEOX-FORK.md, when it is read, then ## Contract shows the probe command and a sample output.  
  Evidence: `docs/SAGEOX-FORK.md` `## Contract` shows the probe command and a sample output (added in this commit).

## fork-init-host-managed

- **fork-init-host-managed.ac1** — Given a temp git repo and OX_HOST_MANAGED=1, when `ox init` runs in the Go test with API registration mocked, then the only new path in `git status --porcelain` is .sageox/.  
  Evidence: eltmon/ox `cmd/ox/host_managed_test.go` `TestHostManaged_InitWritesOnlySageox` (httptest API; only `.sageox/` paths changed, no `.git/hooks` entries); control `TestHostManaged_UnsetInitWritesAgentIntegration`.
- **fork-init-host-managed.ac2** — Given the PR command, when `gh pr view --repo eltmon/ox overdeck/host-managed --json baseRefName` runs, then it returns baseRefName overdeck-base.  
  Evidence: `gh pr view --repo eltmon/ox overdeck/host-managed --json baseRefName` → `overdeck-base` (PR https://github.com/eltmon/ox/pull/1).
- **fork-init-host-managed.ac3** — Given docs/SAGEOX-FORK.md, when it is read, then ## Branches contains the eltmon/ox PR URL and the head SHA.  
  Evidence: `docs/SAGEOX-FORK.md` `## Branches` row "Fork PR": the PR URL and head `de597179542aca4a4815e0b6ab49f75809fa3be7` (added in this commit).

## known-pack-sageox

- **known-pack-sageox.ac1** — Given KNOWN_PACKS, when read, then sageox has url https://github.com/eltmon/ox, adapter plain, skillsRoot extensions/skills and the nine opt-in names from PRD D9.  
  Evidence: `src/lib/skill-packs/__tests__/adapters.test.ts` "marks sageox as a plain pack from the fork with repo-writing skills opt-in" (url, plain, `extensions/skills`, the nine opt-in names, disclosure).
- **known-pack-sageox.ac2** — Given a fixture repo with extensions/skills/a/SKILL.md, when readPackManifest(root, 'plain', { skillsRoot: 'extensions/skills' }) runs, then it returns skill a.  
  Evidence: `adapters.test.ts` "scans skillsRoot instead of skills/ when given".
- **known-pack-sageox.ac3** — Given addPack({ id: 'sageox', url: <fixture>, ref: 'main' }), when it runs, then it proceeds to the git steps instead of rejecting with an integration error.  
  Evidence: `src/lib/skill-packs/__tests__/sources.test.ts` "reports git failures as PackSourceError git": `addPack({ id: 'sageox', … })` reaches the git step (code `git`); live: `pan skills pack add sageox https://github.com/eltmon/ox --ref overdeck/host-managed --yes` registered it.
- **known-pack-sageox.ac4** — Given the source tree, when `grep -rn "'integration'" src/lib/skill-packs` runs, then it returns no matches.  
  Evidence: `grep -rn "'integration'" src/lib/skill-packs` → 0 matches.

## sageox-upload-flag

- **sageox-upload-flag.ac1** — Given project p without sageox_upload, when `pan skills pack sageox upload on --project p` runs, then projects.yaml has sageox_upload: enabled for p and every other key of p is preserved.  
  Evidence: Commit "fix(cli): report the sageox upload flag as a boolean in status JSON" (live run, other keys preserved); `src/lib/sageox/__tests__/config.test.ts`.
- **sageox-upload-flag.ac2** — Given sageox_upload: bogus for p, when readSageoxUpload('p') runs, then it returns false.  
  Evidence: `config.test.ts` "reads unset and unknown values as disabled".
- **sageox-upload-flag.ac3** — Given an unknown project key, when `pan skills pack sageox upload on --project nope` runs, then it exits 1 with an unknown-project message and writes nothing.  
  Evidence: Live: `upload on --project nope` → exit 1, "unknown project: nope"; `config.test.ts` "refuses an unknown project"; `skills.test.ts` "rejects a bad state and an unknown project".
- **sageox-upload-flag.ac4** — Given upload enabled for p, when `pan skills pack sageox status --project p --json` runs, then it prints JSON with upload true for p.  
  Evidence: Live `status --project sgx --json` → `"upload": true`; `skills.test.ts` "reports pack and upload state per project as JSON".

## ox-probe

- **ox-probe.ac1** — Given a fake binary printing valid contract JSON, when probeOxHostContract({ bin }) runs, then it returns ok true with that version and commit.  
  Evidence: `src/lib/sageox/__tests__/probe.test.ts` "returns version and commit for a contract binary".
- **ox-probe.ac2** — Given a fake binary exiting 1 with 'unknown command', when the probe runs, then it returns ok false with reason no-contract.  
  Evidence: `probe.test.ts` "reports no-contract when the command is unknown (exit 1)"; live: upstream `ox 0.2.0` → `no-contract`.
- **ox-probe.ac3** — Given malformed JSON output, when the probe runs, then it returns reason bad-output; given a nonexistent path, it returns reason missing.  
  Evidence: `probe.test.ts` "reports bad-output for malformed JSON" and "reports missing when the binary does not exist".
- **ox-probe.ac4** — Given an injected exec that never settles and fake timers advanced past 2000 ms, when the probe runs, then it returns reason timeout.  
  Evidence: `probe.test.ts` "reports timeout when the binary hangs past the deadline": fake timers advanced 2000 ms past an `exec sleep 30` script (the probe owns its timer and AbortSignal).

## claude-launch-wiring

- **claude-launch-wiring.ac1** — Given the sageox pack off, when the Claude launch step runs, then the settings JSON has no env and no hooks keys and the mount selection has no sageox pack.  
  Evidence: `src/lib/sageox/__tests__/launch.test.ts` "is inactive and silent when the pack is off" (no settings); `src/cli/commands/__tests__/skills.test.ts` "prints the warning, adds no SageOx keys and excludes sageox when inactive" (exclude set `{sageox}` passed to the mount).
- **claude-launch-wiring.ac2** — Given the pack on, a .sageox/ dir at the git root, a passing probe and upload disabled, when resolveSageoxLaunch runs, then env has OX_HOST_MANAGED=1, OX_HOST_NETWORK=off and OX_SESSION_PUBLISHING=manual, and hooks has six events whose commands start with 'if command -v ox' and contain OX_HOST_MANAGED=1.  
  Evidence: `launch.test.ts` "wires env and six hooks with uploads off by default"; live: `.pan/drafts/PAN-2444-live-checkpoint.md` section 2.
- **claude-launch-wiring.ac3** — Given the same with upload enabled for the project, when resolveSageoxLaunch runs, then env has OX_HOST_NETWORK=on and OX_SESSION_PUBLISHING=auto.  
  Evidence: `launch.test.ts` "turns the network and publishing on when the project upload flag is enabled".
- **claude-launch-wiring.ac4** — Given the pack on but a missing .sageox/ dir or a failing probe, when the launch step runs, then it emits one stderr warning naming the failed condition, the JSON has no SageOx keys, and the sageox pack is excluded from the mount.  
  Evidence: `launch.test.ts` ".sageox/ missing", "not in a git repo", "host contract probe fails", "a dependency throws" cases; `skills.test.ts` inactive case; live: section 3 of the checkpoint (upstream ox: one warning, empty JSON, no mount).
- **claude-launch-wiring.ac5** — Given the pack on and harness codex, when the launch step runs, then the sageox pack is excluded from the Codex mount and one warning is emitted.  
  Evidence: `launch.test.ts` "never wires Codex and warns when the pack would have been on"; `skills.test.ts` "excludes sageox from Codex and prints the Codex warning".

## doctor-sageox

- **doctor-sageox.ac1** — Given no sageox pack registered, when checkSageox runs, then it returns an empty array.  
  Evidence: `src/cli/commands/__tests__/doctor-sageox.test.ts` "adds no row when the sageox pack is not registered".
- **doctor-sageox.ac2** — Given a registered sageox pack and a probe returning ok with a matching commit, when checkSageox runs, then it returns one row with status ok.  
  Evidence: `doctor-sageox.test.ts` "is ok when the contract binary was built from the pack commit"; live: checkpoint section 5 (`✓ SageOx (ox): … commit matches pack`).
- **doctor-sageox.ac3** — Given a probe returning no-contract, when checkSageox runs, then it returns status warn with the go build fix text.  
  Evidence: `doctor-sageox.test.ts` "warns with fix text for upstream ox without the host contract"; live: checkpoint section 5 (`⚠ … upstream ox, no host contract` + fix).
- **doctor-sageox.ac4** — Given the branch, when `bash scripts/lint-file-size.sh` runs, then it exits 0 and doctor.ts line count is at or below its origin/main count; tests/integration/cli/doctor.test.ts still imports checkKimi from doctor.js.  
  Evidence: `bash scripts/lint-file-size.sh` passed; `doctor.ts` is 1015 lines vs 1037 on `origin/main`; `tests/integration/cli/doctor.test.ts` still imports `checkKimi` from `doctor.js` and passes.

## ui-disclosure

- **ui-disclosure.ac1** — Given a sageox pack row with a disclosure, when SkillPacksSection renders, then an element with data-testid pack-disclosure shows the disclosure text.  
  Evidence: `SkillPacksSection.test.tsx` "shows the sageox disclosure and none for a pack without one".
- **ui-disclosure.ac2** — Given a pack row with disclosure null, when SkillPacksSection renders, then no pack-disclosure element exists.  
  Evidence: Same test (mattpocock row has no `pack-disclosure`).
- **ui-disclosure.ac3** — Given listSkillStates for a registered sageox pack, when it returns packs, then the sageox entry carries disclosure equal to SAGEOX_DISCLOSURE.  
  Evidence: `src/lib/skill-overrides/__tests__/store.test.ts` "carries the sageox disclosure on its pack row (PAN-2444)".

## docs-sageox

- **docs-sageox.ac1** — Given features/skills.mdx, when searched, then it contains a `### SageOx` heading, the SAGEOX_DISCLOSURE text, `pan skills pack sageox upload`, and `go build -o ~/.local/bin/ox ./cmd/ox`.  
  Evidence: `features/skills.mdx` has `### SageOx`, the exact `SAGEOX_DISCLOSURE` text (checked by string compare), `pan skills pack sageox upload`, and `go build -o ~/.local/bin/ox ./cmd/ox`.
- **docs-sageox.ac2** — Given features/skills.mdx, when searched for 'refuses', then no sentence says `pan skills pack add sageox` refuses.  
  Evidence: `features/skills.mdx` no longer says `pan skills pack add sageox` refuses (grep for "refuses" near sageox: none).
- **docs-sageox.ac3** — Given .overdeck/context/codebase/architecture.md, when read, then it names src/lib/sageox/ and ends with a last-verified comment dated on or after 2026-09-29.  
  Evidence: `.overdeck/context/codebase/architecture.md` names `src/lib/sageox/` and ends with `<!-- last-verified: 2026-09-29 -->`.

## live-checkpoint

- **live-checkpoint.ac1** — Given the fork build on PATH, when launch-settings runs, then the captured JSON in the checkpoint file contains OX_HOST_MANAGED and six hook events.  
  Evidence: `.pan/drafts/PAN-2444-live-checkpoint.md` section 2: JSON with `OX_HOST_MANAGED` and six hook events.
- **live-checkpoint.ac2** — Given upstream ox 0.2.0 on PATH, when launch-settings runs, then the checkpoint file shows the fail-closed warning and JSON without SageOx keys.  
  Evidence: Checkpoint section 3: upstream warning line and empty stdout (no SageOx keys).
- **live-checkpoint.ac3** — Given the uninitialized throwaway repo, when the fork hook runs under OX_HOST_MANAGED=1, then the checkpoint file shows empty `git status --porcelain` output.  
  Evidence: Checkpoint section 4: uninitialized repo, empty `git status --porcelain`.
- **live-checkpoint.ac4** — Given both PATH setups, when pan doctor runs, then the checkpoint file shows an ok SageOx row and a warn SageOx row.  
  Evidence: Checkpoint section 5: `✓ SageOx (ox)` with the fork, `⚠ SageOx (ox)` with upstream.
