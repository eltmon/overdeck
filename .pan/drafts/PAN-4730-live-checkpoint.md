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
