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

## Fork: ~/.gstack rewrite

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

## Fork: pack browser test

Fork commit: `fb781f7177b9edc8bca724ea6180611462e9f6fd` — `test(pack-browser): the browser step runs only the pinned commands and writes only R and C`.

Files: `test/pack-browser.test.ts` (new), `docs/pack-mode.md` (the `## Test` section lists the three pack-browser test files).

Notes on the plan:

- Each case renders its own fresh `R`, because the success and failure cases change `R`.
- The floor case checks that the only bun call was `--version` (stronger than "no `install` line"), and that `C` was never created.
- No registry change was needed for the new test file: the free-test ratchets, `test/exercised-map.test.ts` and `test/helpers/hermetic-env.test.ts` pass with it.

```
$ bun test test/pack-browser.test.ts test/pack-browser-guards.test.ts test/pack-env.test.ts test/pack-mode.test.ts test/setup-help.test.ts test/state-root-ratchet.test.ts test/free-seed-ratchet.test.ts test/test-free-shards.test.ts test/free-fixtures.test.ts test/exercised-map.test.ts test/helpers/hermetic-env.test.ts
 188 pass
 0 fail
 2998 expect() calls
Ran 188 tests across 11 files. [38.48s]
```

## Fork: publish

Branch `overdeck/pack-browser` pushed to `https://github.com/eltmon/gstack`. PR opened inside the fork with `gh pr create --repo eltmon/gstack --base main --head overdeck/pack-browser`; not merged (operator's call). No upstream contact.

```
$ gh pr view --repo eltmon/gstack overdeck/pack-browser --json baseRefName,headRefName,state,isCrossRepository,url
{"baseRefName":"main","headRefName":"overdeck/pack-browser","isCrossRepository":false,"state":"OPEN","url":"https://github.com/eltmon/gstack/pull/2"}
```

PR: https://github.com/eltmon/gstack/pull/2

**Pack-browser SHA** (used by the live acceptance): `fb781f7177b9edc8bca724ea6180611462e9f6fd`

After the operator's review of #2, the PR head is `92a51a50ee5c065690b4a2db212ea6be5d469c35` (see "Fork: review fix" below); the isolated-HOME live rerun used it.

## Live acceptance

Run 2026-11-01 from this workspace's build (`bun install` then `npm run typecheck` rc 0 and `npm run build` rc 0), `P=node /home/eltmon/Projects/overdeck/workspaces/feature-pan-4730/dist/cli/index.js`, with `OVERDECK_HOME=/tmp/pan-4730-live/overdeck-home` on every `$P` command. No `pan up`, `pan start` or dashboard command used the isolated home. Fork commit: the pack-browser SHA `fb781f7177b9edc8bca724ea6180611462e9f6fd`. Host bun 1.3.14 (the fork's floor is 1.3.3; it reports `untested` below 1.4.2). `bun install --frozen-lockfile` accepted the lockfile, so **no `bun upgrade` was needed** and the host bun is unchanged.

Deviations and findings:

- **ffmpeg download.** `bun x playwright install chromium` also downloaded `ffmpeg-1011` next to `chromium-1234` and `chromium_headless_shell-1234`. The consent preview's last line did not name it; commit "fix(cli): name ffmpeg in the gstack browser consent preview" fixes the line (D13 requires every download).
- **SIGTERM is ignored.** gstack's headless browse daemon ignores SIGTERM (fork `browse/src/server.ts:1410-1421`: `Received SIGTERM (ignoring — use /stop or Ctrl+C for intentional shutdown)`). The plan's daemon hint `kill <n>` left it running; `kill -INT <n>` stopped the daemon, its terminal agent and Chromium in 2 s. Commit "fix(cli): tell operators to stop a gstack browse daemon with SIGINT" changes the hint.
- **Order of steps 6-8.** The daemon was left running through step 8 so that `browser off` could show the live daemon report; it was then stopped with `kill -INT` instead of `$B stop` (the `off` re-render had already removed the compiled `browse`).
- **`~/.bun` changed, not by gstack.** The after-snapshot found 9 new files in `~/.bun/install/cache` (16:34:37). They are npm registry manifests for `@types/node`, `tsdown`, `typescript`, `vitest`, `conf`, `electron-builder`, `electron-updater`, `@electron/notarize`, `@electron/rebuild`: Overdeck's own `apps/desktop` dependency set (gstack's `package.json` names none of them). Another Overdeck workspace's `bun install` wrote them while this run was in progress (three agents were running). The pack's own bun cache went to `C/bun-cache`.
- **Blocked postinstalls.** `bun pm untrusted` in `R` lists `onnxruntime-node@1.30.0` and `protobufjs@7.6.6` (their lifecycle scripts were blocked); `sharp` is not listed. They were not trusted. The QA run below did not need them.
- `/tmp/browse-no-sfx-*` dirs exist from 15:51, before this run started (16:31); the run wrote none.

### Steps 1-3

```
$ cat /tmp/pan-4730-live/project/index.html        # git init + commit "init"
<!doctype html><title>Live QA</title><h1>Hello</h1><button id=b onclick="document.title='clicked'">Go</button>
$ cat $OVERDECK_HOME/projects.yaml
projects:
  live:
    name: live
    path: /tmp/pan-4730-live/project
    issue_prefix: LIVE
$ python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/pan-4730-live/project &   # port 8765 was free
$ cat /tmp/pan-4730-live/before.txt
6306dc702170a848544c7d47e02483a42cb0aec999709bd7c38db33c349b8471  /home/eltmon/.claude/settings.json
c9a73c3e3290bd83596ef7353204e605640e0e6526da45fe1ff4ac39e36aa6ee  -        (ls -la ~/.cache/ms-playwright)
0                                                                        (files in ~/.bun newer than start)
no-gstack
```

### Step 4: add --browser

```
$ $P skills pack add gstack https://github.com/eltmon/gstack --ref fb781f7177b9edc8bca724ea6180611462e9f6fd --browser --yes
Pack gstack
  Source       https://github.com/eltmon/gstack @ fb781f7177b9edc8bca724ea6180611462e9f6fd (fb781f7)
  Skills       36 (14 opt-in: …)
  Not mounted  27: benchmark (Needs the browser runtime: pan skills pack browser gstack on); browse (…); …
  Runs         bash setup --pack-root …/render/fb781f71… --pack-state-root …/packs/gstack/state
  Executables  233 files the mounted skills can run:
  …
Trusted gstack @ fb781f7.
Pack gstack                                   (second preview: the browser runtime)
  Skills       54 (23 opt-in: autoplan, benchmark-models, canary, captain, careful, codex, cso, design-consultation, …)
  Not mounted  9: connect-chrome (…); gstack-upgrade (…); open-gstack-browser (Opens a visible browser …); …
  Runs         bash setup --pack-browser /tmp/pan-4730-live/overdeck-home/packs/gstack/render/fb781f7177b9edc8bca724ea6180611462e9f6fd --pack-browser-cache /tmp/pan-4730-live/overdeck-home/packs/gstack/browser
  Downloads    15 lines, every package and file the build fetches:
                @anthropic-ai/sdk@^0.78.0
                @huggingface/transformers@^4.3.1
                @ngrok/ngrok@^1.7.0
                cross-spawn@^7.0.6
                diff@^9.0.0
                html-to-docx@1.8.0
                html-to-vdom@0.7.0
                marked@^18.1.1
                playwright@^1.62.1
                sharp@^0.35.4
                socks@^2.8.10
                xterm@^5.3.0
                xterm-addon-fit@^0.8.0
                + their locked dependencies from bun.lock (registry.npmjs.org)
                Chromium and Chromium headless shell for playwright ^1.62.1 (Playwright CDN, ~115 MiB download)   (before the ffmpeg fix)
  Writes       6 paths: …/node_modules, …/browse/dist, …/design/dist, …/make-pdf/dist, …/browser/bun-cache, …/browser/playwright
  Size         about 1 GB on disk
Trusting runs the command above once now and downloads the listed packages and Chromium.
Browser runtime for gstack is on. Browser skills mount at the next launch.
rc=0
$ cat $R/.gstack-pack-browser.json
{"packBrowser":1,"browsersPath":"/tmp/pan-4730-live/overdeck-home/packs/gstack/browser/playwright","version":"1.92.33.0"}
$ ls $C/playwright
chromium-1234  chromium_headless_shell-1234  ffmpeg-1011
$ du -sh $R/node_modules $C
576M  …/render/fb781f71…/node_modules
675M  …/packs/gstack/browser
$ ls -la $R/browse/dist/browse $R/browse/dist/find-browse $R/design/dist/design $R/make-pdf/dist/pdf $R/bin/gstack-global-discover
-rwxr-xr-x (≈95 MB each, all five present)
$ (cd $R && BUN_INSTALL_CACHE_DIR=$C/bun-cache bun pm untrusted)
./node_modules/onnxruntime-node @1.30.0  » [postinstall]: node ./script/install
./node_modules/protobufjs @7.6.6          » [postinstall]: node scripts/postinstall
$ $R/bin/gstack-browser-ensure --check --quiet
BROWSER_OK node 151.0.7922.34
$ grep -c "~/.gstack/" $R/design-shotgun/SKILL.md
0
```

### Step 5: on for the project

```
$ $P skills set --pack gstack on --project live
gstack (pack): on at project live
$ $P skills launch-settings --harness claude-code --cwd /tmp/pan-4730-live/project --plugin-link /tmp/pan-4730-live/link
[launcher] deft: pack off; project not directive; read-only
$ ls /tmp/pan-4730-live/link/gstack/skills
benchmark browse context-restore context-save design-motion deslop-shared-libs devex-review diagram health investigate ios-clean ios-design-review ios-fix ios-qa ios-sync landing-report learn make-pdf plan-ceo-review plan-devex-review plan-eng-review qa qa-only retro review scrape skillify spec test-audit verify write-skill
   (qa, qa-only, browse present; ship and pair-agent absent)
```

### Step 6: /gstack:qa-only runs against the local page

```
$ cd /tmp/pan-4730-live/project && env -u CLAUDECODE -u CLAUDE_CODE_* -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_PLUGIN_DATA … GSTACK_SESSION_KIND=spawned \
    claude -p "/gstack:qa-only Test http://127.0.0.1:8765/ — click the Go button and confirm the title changes; report only, do not edit files." \
    --plugin-dir /tmp/pan-4730-live/link --output-format stream-json --verbose --allowedTools "Bash Read Grep Glob Write" > qa.jsonl
result: {'subtype': 'success', 'is_error': False, 'num_turns': 60, 'duration_ms': 275937, 'total_cost_usd': 1.95}
result text (start): "The Go button works: clicking it changes the browser tab title from "Live QA" to "clicked". I checked it again after reloading the page and got the same result. …"
qa.jsonl: BROWSER_OK node 151.0.7922.34
qa.jsonl: 138 calls of /tmp/pan-4730-live/overdeck-home/packs/gstack/render/fb781f7177b9edc8bca724ea6180611462e9f6fd/browse/dist/browse
init: 31 gstack:* slash commands, including gstack:qa, gstack:qa-only, gstack:browse, gstack:make-pdf (no ship, no pair-agent)
$ find $OVERDECK_HOME/packs/gstack/state/projects -type f
…/state/projects/project/timeline.jsonl
…/state/projects/project/<user>-master-test-outcome-20261101T213608Z.md      (the report copy under S)
$ ls /tmp/pan-4730-live/project/.gstack
browse-audit.jsonl browse-daemon.log browse-network.log browse.json claude-available.json qa-reports terminal-agent-pid terminal-internal-token terminal-port
```

The daemon found the markers with no launch env (the `fork-pack-env` proof):

```
$ tr '\0' '\n' < /proc/<browse.json pid>/environ | grep -E 'GSTACK_STATE_ROOT|PLAYWRIGHT_BROWSERS_PATH|BUN_RUNTIME_TRANSPILER'
GSTACK_STATE_ROOT=/tmp/pan-4730-live/overdeck-home/packs/gstack/state
PLAYWRIGHT_BROWSERS_PATH=/tmp/pan-4730-live/overdeck-home/packs/gstack/browser/playwright
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
$ tr '\0' ' ' < /proc/<pid>/cmdline
bun run --no-env-file --config=/dev/null /tmp/pan-4730-live/overdeck-home/packs/gstack/render/fb781f71…/browse/src/server.ts
```

### Step 7: nothing written outside the pack

```
$ diff before.txt after.txt
3c3
< 0
---
> 10        (~/.bun/install/cache: Overdeck apps/desktop manifests from another workspace's bun install; see Deviations)
   (line 1 ~/.claude/settings.json and line 2 ~/.cache/ms-playwright unchanged; line 4 no-gstack unchanged)
$ find ~/.claude -newer start -path '*gstack*' -not -path '*/.claude/plugins/*' -not -path '*/.claude/projects/*'
(no output)
$ ls $OVERDECK_HOME/packs/gstack/browser/playwright
chromium-1234  chromium_headless_shell-1234  ffmpeg-1011
```

### Step 8: browser off

```
$ $P skills pack browser gstack off
Browser runtime for gstack is off; /tmp/pan-4730-live/overdeck-home/packs/gstack/render/fb781f7177b9edc8bca724ea6180611462e9f6fd was rendered again without it and /tmp/pan-4730-live/overdeck-home/packs/gstack/browser was removed.
Browse daemon still running in /tmp/pan-4730-live/project: pid 1196474 — stop with: kill 1196474      (hint before the SIGINT fix)
$ test ! -e $R/node_modules; test ! -e $OVERDECK_HOME/packs/gstack/browser; test -f $R/.gstack-pack.json; test ! -e $R/.gstack-pack-browser.json
no node_modules / no browser dir / render ready / no browser marker
$ grep -A4 'gstack:' $OVERDECK_HOME/config.yaml          # no browser key
    gstack:
      url: https://github.com/eltmon/gstack
      ref: fb781f7177b9edc8bca724ea6180611462e9f6fd
      commit: fb781f7177b9edc8bca724ea6180611462e9f6fd
$ kill 1196474   → still alive after 12 s; daemon log: "Received SIGTERM (ignoring — use /stop or Ctrl+C for intentional shutdown)"
$ kill -INT 1196474   → "Shutting down…", stopped after 2 s; terminal agent and Chromium gone
$ $P skills launch-settings --harness claude-code --cwd /tmp/pan-4730-live/project --plugin-link /tmp/pan-4730-live/link
$ ls /tmp/pan-4730-live/link/gstack/skills | grep -cE '^(qa|qa-only|browse)$'
0          (22 default skills remain)
```

### Step 9: remove leaves nothing

```
$ $P skills pack remove gstack
Removed pack gstack, its cache, 2 mount(s) and 0 Codex cache(s).
Project files gstack skills wrote (not removed): /tmp/pan-4730-live/project/.gstack  — remove with: rm -rf /tmp/pan-4730-live/project/.gstack
1 project or issue toggle(s) for gstack remain; they do nothing unless gstack is added again.
$ find $OVERDECK_HOME -path '*gstack*'
(no output)
$ test ! -e ~/.gstack && echo no-gstack
no-gstack
$ (~/.claude/settings.json and ~/.cache/ms-playwright listing hashes equal before.txt)
```

The http server was stopped and `/tmp/pan-4730-live` removed.

## Fork: review fix (XDG_CACHE_HOME)

Operator review of eltmon/gstack#2: a real build with an empty HOME passed (BROWSER_OK), but Chromium's launch wrote `$HOME/.cache/fontconfig/*.cache-11` and `$HOME/.cache/nvidia/GLCache`. Fork commit `92a51a50ee5c065690b4a2db212ea6be5d469c35` — `fix(pack-browser): keep Chromium's caches out of $HOME`, pushed to `overdeck/pack-browser` (PR #2 not merged; the operator merges it):

- `scripts/pack-browser.sh` exports `XDG_CACHE_HOME="$C/xdg-cache"` with the other cache variables and creates it.
- `lib/pack-env.ts` `applyPackEnv` sets `XDG_CACHE_HOME`, when unset, to `dirname(<.gstack-pack-browsers-path value>)/xdg-cache`, so the compiled CLIs and the browse daemon keep Chromium's caches in the pack at runtime.
- `bin/gstack-browser-ensure` does the same in a render (from the marker's value, not an inherited `PLAYWRIGHT_BROWSERS_PATH`).
- Tests: `test/pack-env.test.ts`, `test/pack-browser-guards.test.ts`, `test/pack-browser.test.ts`; `docs/pack-mode.md` names the variable.

```
$ bun test test/pack-env.test.ts test/pack-browser-guards.test.ts test/pack-browser.test.ts test/gstack-browser-ensure.test.ts test/pack-mode.test.ts test/setup-help.test.ts test/state-root-ratchet.test.ts test/free-seed-ratchet.test.ts test/test-free-shards.test.ts test/free-fixtures.test.ts test/exercised-map.test.ts test/helpers/hermetic-env.test.ts design/test/auth.test.ts
 211 pass
 0 fail
 3088 expect() calls
Ran 211 tests across 13 files. [38.47s]
```

Overdeck follow-up: the consent preview's `Writes` list now names `<C>/xdg-cache`.

## Live acceptance rerun at 92a51a50 (isolated HOME)

Run 2026-11-01 with `HOME=/tmp/pan-4730-live2/home` (empty) and `OVERDECK_HOME=/tmp/pan-4730-live2/overdeck-home` on every command, including `claude -p`. Claude Code authenticated through `CLAUDE_CONFIG_DIR=/home/eltmon/.claude`; `XDG_CACHE_HOME` was unset for the run.

Deviations and findings:

- **`CLAUDE_CONFIG_DIR` side effect.** Pointing it at the real config dir made Claude Code create `/home/eltmon/.claude/.claude.json` (61 KB, born 16:45:49 by the one-turn auth probe). The normal launch path reads `~/.claude.json` and does not use that file. It was left in place for the operator to keep or delete.
- **The isolated HOME cannot be empty after a `claude -p` run.** Claude Code writes `HOME/.cache/claude-cli-nodejs` (its MCP logs), and the hooks in the real `~/.claude/settings.json` wrote `HOME/.overdeck/` (Overdeck hooks) and `HOME/.tokentracker/`, `HOME/.config/tokentracker/`. None of these come from gstack. The assertion is therefore: `HOME/.cache` holds nothing but `claude-cli-nodejs`.
- **One gstack write to HOME remains:** `HOME/.bun/install/cache/@t@/0018b284b7b425ee.pile` (34 KB, gstack's `lib/redact-patterns.ts` transpiled), written when the skill ran `bun R/bin/gstack-qa-evidence materialize …` from the agent's shell, which has no `BUN_RUNTIME_TRANSPILER_CACHE_PATH`. It is outside `.cache` and outside the requested fix; recorded under Limits in `features/skills.mdx`.

```
$ $P skills pack add gstack https://github.com/eltmon/gstack --ref 92a51a50ee5c065690b4a2db212ea6be5d469c35 --browser --yes
… Browser runtime for gstack is on. Browser skills mount at the next launch.   rc=0
$ ls $C;  ls $C/xdg-cache
bun-cache  playwright  xdg-cache
fontconfig  nvidia                      (Chromium's caches, in the pack)
$ find $HOME                            (after the build)
/tmp/pan-4730-live2/home                (empty)
$ $P skills set --pack gstack on --project live; $P skills launch-settings … --plugin-link $L/link
browse qa qa-only mounted; ship, pair-agent absent
$ … HOME=$L/home CLAUDE_CONFIG_DIR=/home/eltmon/.claude GSTACK_SESSION_KIND=spawned claude -p "/gstack:qa-only Test http://127.0.0.1:8765/ — click the Go button and confirm the title changes; report only, do not edit files." --plugin-dir $L/link …
result: {'subtype': 'success', 'is_error': False, 'num_turns': 41, 'duration_ms': 168729, 'total_cost_usd': 1.39}
result text (start): "The test passed: clicking Go changes the page title, and nothing broke. …"
qa.jsonl: BROWSER_OK node 151.0.7922.34
report copy: $OVERDECK_HOME/packs/gstack/state/projects/project/unknown-user-master-test-outcome-20261101T214903Z.md
$ ls -A $HOME/.cache
claude-cli-nodejs                       (no fontconfig, no nvidia: PASS)
$ tr '\0' '\n' < /proc/<daemon pid>/environ | grep -E '^(HOME|XDG_CACHE_HOME|PLAYWRIGHT_BROWSERS_PATH|GSTACK_STATE_ROOT)='
HOME=/tmp/pan-4730-live2/home
GSTACK_STATE_ROOT=/tmp/pan-4730-live2/overdeck-home/packs/gstack/state
PLAYWRIGHT_BROWSERS_PATH=/tmp/pan-4730-live2/overdeck-home/packs/gstack/browser/playwright
XDG_CACHE_HOME=/tmp/pan-4730-live2/overdeck-home/packs/gstack/browser/xdg-cache
$ $P skills pack browser gstack off
Browse daemon still running in /tmp/pan-4730-live2/project: pid 2511034 — stop with: kill -INT 2511034
$ kill -INT 2511034  → daemon stopped within 3 s
$ $P skills pack remove gstack
Removed pack gstack, its cache, 1 mount(s) and 0 Codex cache(s).
$ find $OVERDECK_HOME -path '*gstack*'
(no output)
$ test ! -e ~/.gstack && echo no-gstack
no-gstack
```

The http server was stopped and `/tmp/pan-4730-live2` removed.
