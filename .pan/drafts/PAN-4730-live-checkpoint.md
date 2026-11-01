# PAN-4730 live verification checkpoint

Fork clone: `$HOME/Projects/gstack`, branch `overdeck/pack-browser`, created from `origin/main` @ `1b778f78602ae4793f426164a9ff49fafbd83157` (the clone was clean on `overdeck/pack-mode` before the switch; `origin` = `https://github.com/eltmon/gstack`).

## Fork: pack env

Fork commit: `321dbcfc28e45d235eb895ce7835ec8f0c181503` — `feat(pack-browser): pack env helper for compiled binaries and the daemon`.

Files: `lib/pack-env.ts` (new: `packRootFor`, `applyPackEnv`), `lib/pack-env-apply.ts` (new side-effect module), `browse/src/cli.ts`, `design/src/cli.ts`, `make-pdf/src/cli.ts` (`import '../../lib/pack-env-apply';` as the first import line), `design/src/auth.ts` (`configPath` → `path.join(resolveStateRoot(), …)`), `browse/src/project-slug.ts` (pack's own `bin/gstack-slug` when `packRootFor()` finds a render), `test/pack-env.test.ts` (new), `design/test/auth.test.ts` (one case).

Implementation checkpoint (import graphs): a walk of the static imports of each CLI found one module-level state-root read in the CLI graphs, `browse/src/cli.ts:27` `const config = resolveConfig();`, which is in the CLI's own body and runs after every import. `browse/src/security-classifier.ts:48` `const MODELS_DIR = path.join(resolveStateRoot(), 'models');` is in the daemon's graph (`server.ts`), which runs from source and inherits the env. The remaining reads (`make-pdf` setup/orchestrator, `design` daemon) are dynamic `await import(...)` calls, which evaluate after the side-effect import. The compiled probe test confirms bun evaluates the side-effect import before a later import's load-time `resolveStateRoot()`.

Notes on the plan:

- `applyPackEnv` leaves `GSTACK_STATE_ROOT` unset when any of `GSTACK_STATE_ROOT`, `GSTACK_HOME`, `GSTACK_STATE_DIR` is set, so an explicit `GSTACK_HOME` still wins (FR-4 "explicitly set env values win"). It reuses `packMarkerRoot` from `lib/state-root.ts` to read the markers.
- Bun hands a child process its startup environment unless `env` is passed, so mutating `process.env` alone does not reach children spawned with the default env. Both daemons already spawn with `env: { ...process.env, … }` (`browse/src/cli.ts` `nodeSpawn('bun', ['run', …, server.script], …)`, `design/src/daemon-client.ts` `spawnDaemon`), and Playwright reads `PLAYWRIGHT_BROWSERS_PATH` in-process, so the env reaches them. The probe test spawns its child the same way.
- `test/state-root-ratchet.allowlist.json` had no row for `design/src/auth.ts` (its old `process.env.HOME, ".gstack"` join did not match the ratchet's `homedir()` pattern), so nothing was removed.
- User-facing messages in `design/src/auth.ts` (`describeApiKeySource`, the `.env` billing warning, the no-key error) still print `~/.gstack/<file>`; only the path the key is read from and written to moved. `design/test/auth.test.ts` asserts the `~/.gstack/openai.json` text for the default case.
- No test-registry change was needed: the free-test ratchets pass with the new test file.

```
$ bun test test/pack-env.test.ts design/test/auth.test.ts test/state-root-parity.test.ts test/state-root-ratchet.test.ts test/free-seed-ratchet.test.ts test/test-free-shards.test.ts test/free-fixtures.test.ts
 158 pass
 0 fail
 2700 expect() calls
Ran 158 tests across 7 files. [13.84s]
```

Related CLI suites (`browse/test/cli-*.test.ts`, `browse/test/server-no-import-side-effects.test.ts`, `make-pdf/test/cli-*.test.ts`, `design/test/cli-*.test.ts`): 47 pass, 6 fail. All six fail on packages missing from the clone's `node_modules` (`Cannot find package 'socks'` from `browse/src/socks-bridge.ts`; `Cannot find package 'html-to-vdom'` from `make-pdf/src/docx-images.ts`), in modules this item does not touch. The fork clone has no `node_modules` at all (both packages are in `package.json` `dependencies`); `bun install` was not run (network, and it would change the clone outside this item).

## Fork: render guards

Fork commit: `0b6671215a96cd6711a213b3272ed2c2030bab7d` — `feat(pack-browser): pack renders never install themselves`.

Files: `bin/gstack-browser-ensure`, `setup`, `test/pack-browser-guards.test.ts` (new).

Notes on the plan:

- `bin/gstack-browser-ensure`: `PACK=1` when `$ROOT/.gstack-pack.json` exists (`ROOT` = the script's `bin/..`). The two install points route to `fail "pack browser runtime not built" "pan skills pack browser gstack on"`. After a failed probe the reason also carries the probe's first line (`pack browser runtime not built, or Chromium did not launch via <engine> (<line>)`), since a built runtime can still fail to launch (sandbox, missing system libraries). The `--help` range moved from `3,24p` to `3,26p` for the two added header lines.
- `setup`: the guard sits directly after the parser loop and before the `--pack-root` dispatch. It already names `${PACK_BROWSER:-}${PACK_BROWSER_CACHE:-}`, so WI-F4 only adds the parser flags. `--help` and `--status` short-circuit above the parser and still run inside a render.

```
$ bun test test/pack-browser-guards.test.ts test/setup-help.test.ts test/gstack-browser-ensure.test.ts test/pack-mode.test.ts test/free-seed-ratchet.test.ts test/test-free-shards.test.ts test/free-fixtures.test.ts test/state-root-ratchet.test.ts test/exercised-map.test.ts test/helpers/hermetic-env.test.ts
 189 pass
 0 fail
 2954 expect() calls
Ran 189 tests across 10 files. [31.14s]
```

## Fork: render gstack paths

Fork commit: `e746e65edf637a771d36c02cfab577d69f6111c3` — `feat(pack-mode): point literal ~/.gstack paths in skill docs at the state root`.

Files: `scripts/pack-render.sh`, `test/pack-mode.test.ts`, `docs/pack-mode.md` (one sentence in "What it writes" step 2; not in the plan's file list, added so the contract doc matches the render).

Notes on the plan:

- The rewrite uses `sed … "$f" > "$f.pack-tmp"; mv "$f.pack-tmp" "$f"` instead of `sed -i.bak`, so no `.bak` cleanup (`rm`) is needed and it behaves the same on GNU and BSD. Only files that contain a token are rewritten. 76 source `*/SKILL.md` and `*/sections/*.md` files contain one of the three tokens.
- Only the trailing-slash forms are rewritten, as the plan specifies; a bare `~/.gstack` with no slash (prose such as "writes ~/.gstack") is left as is.

```
$ bun test test/pack-mode.test.ts test/state-root-ratchet.test.ts test/pack-browser-guards.test.ts
 13 pass
 0 fail
 63 expect() calls
Ran 13 tests across 3 files. [2.46s]
```

## Fork: pack browser step

Fork commit: `4de69f3f998d1a71b9294313f7531e3661920043` — `feat(pack-browser): build the browser runtime into a pack render`.

Files: `setup` (parser flags `--pack-browser`/`--pack-browser-cache` and their `=` forms, typo-suggestion list, `-h` text, dispatch, the `--pack-root`+`--pack-browser` refusal), `scripts/pack-browser.sh` (new, executable), `pack-mode.json`, `docs/pack-mode.md` (`## Pack browser`, with `### Markers instead of environment` and `### Renders never install themselves`).

```
$ bash setup --help | grep -c pack-browser
2
$ cat pack-mode.json
{"packMode": 1, "packBrowser": 1}
$ bash setup --pack-browser rel --pack-browser-cache /x      # exit 2
pack browser: --pack-browser and --pack-browser-cache must be plain absolute paths
$ bash setup --pack-browser <tmp>/none --pack-browser-cache <tmp>/c   # exit 2, <tmp> stays empty
pack browser: <tmp>/none is not a ready pack render
$ bash setup --pack-root <tmp>/r --pack-browser <tmp>/r2   # exit 2
setup: run --pack-root and --pack-browser separately
```

Notes on the plan:

- The `-h` text avoids the literal words "bun install": `test/setup-help.test.ts` treats them in `--help` output as a sign the installer ran. It reads "locked production dependencies, the compiled binaries, and Playwright Chromium".
- The bun check sources `R/bin/gstack-bun-version.sh` and accepts `gstack_bun_status` results `ok` and `untested`. `too-old` exits 1 with the D3 message; `malformed` also exits 1 (`cannot compare bun version …`).
- The Chromium step reuses `bin/gstack-browser-ensure`'s background-and-poll timeout loop instead of the `timeout` command, which macOS lacks.
- On failure the cleanup also removes the three `dist/.version` files (not in FR-2's list; they are written by this step).
- A manual smoke run before the commit (stub `bun` and `node`, real render) passed the success path and the failure cleanup; WI-F5 turns it into `test/pack-browser.test.ts`.
