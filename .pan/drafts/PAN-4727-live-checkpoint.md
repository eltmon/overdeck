# PAN-4727 live verification checkpoint

Fork clone: `$HOME/Projects/gstack`, branch `overdeck/pack-mode`, created from `origin/main` @ `1cac25cb8eb1b394136e98ab76ecd2b8fcec458e` (`VERSION` 1.92.33.0).

## Fork: pack render

Fork commit: `95ab733d8d6bc1d751197e98e838c0ba2943d465` — `feat(pack-mode): render skills and runtime into a caller-supplied root`.

Files: `setup` (help text, flag parser, typo-suggestion list, dispatch), `scripts/pack-render.sh` (new), `scripts/gen-skill-docs.ts` (`${HOME}/.claude/skills/gstack` added to the Claude `rewriteInstallRoot` defaults), `pack-mode.json` (new, `{"packMode": 1}`).

Notes on the plan:

- Dispatch placement: `setup` assigns `SOURCE_GSTACK_DIR` at line 296, after the parser loop, so the dispatch computes the directory inline: `exec bash "$(cd "$(dirname "$0")" && pwd -P)/scripts/pack-render.sh" …`. Nothing above the parser writes to disk (only `--help` and the read-only `--status` short-circuits run there), so the dispatch stays directly after the parser loop.
- Section checkpoint (WI-F1 step 5): the generator rewrites every section. Every `*/sections/*.md` without a `.tmpl` is a `preamble.md`, which the generator renders from the shared preamble. After the render, no `R/*/SKILL.md` or `R/*/sections/*.md` names any of the three install-root tokens, so no fallback rewrite was needed.
- `pack-render.sh` also refuses an `R` or `S` inside the source tree (exit 2), which enforces the §5 rule that pack mode never writes into the source tree.

```
$ bash setup --help | grep pack-root
  --pack-root <dir> --pack-state-root <dir>
                    Render every skill and its runtime into --pack-root and
```

Hand-run acceptance against scratch roots (`$SP` = a scratch dir):

```
$ bash setup --pack-root relative/path --pack-state-root $SP/s2; echo rc=$?
pack mode: --pack-root and --pack-state-root must be plain absolute paths
rc=2
$ ls $SP            # nothing written
$ bash setup --pack-root $SP/r --pack-state-root $SP/s; echo rc=$?
rc=0
$ cat $SP/r/.gstack-pack.json
{"packMode":1,"stateRoot":"$SP/s","version":"1.92.33.0"}
$ grep -n "gstack-skill-start --skill" $SP/r/test-audit/SKILL.md
29:$SP/r/bin/gstack-skill-start --skill "test-audit" --model "claude"
$ cat $SP/s/config.yaml
telemetry: off
update_check: false
auto_upgrade: false
$ grep -lE '(~|\$HOME|\$\{HOME\})/\.claude/skills/gstack' $SP/r/*/SKILL.md $SP/r/*/sections/*.md | wc -l
0
$ find $SP/r -type l | wc -l
0
$ printf 'telemetry: community\n' > $SP/s/config.yaml; sha256sum $SP/s/config.yaml
84f8cceee1e1152557fcf164c4bf5e6f7ef628a4d6b8d48dd6e3d5bb1fb64523
$ bash setup --pack-root $SP/r2 --pack-state-root $SP/s; echo rc=$?; sha256sum $SP/s/config.yaml
rc=0
84f8cceee1e1152557fcf164c4bf5e6f7ef628a4d6b8d48dd6e3d5bb1fb64523
$ bash setup --pack-root $SP/r --pack-state-root $SP/s; echo rc=$?     # R not empty
pack mode: --pack-root must be absent or empty ($SP/r)
rc=2
```

Fork tests run: `bun test test/setup-help.test.ts` (12 pass, 0 fail), `bun test test/external-host-carve.test.ts` (29 pass, 0 fail).

## Fork: state-root marker

Fork commit: `ef70d6d0cda6396b808c76c0a06678860dade32e` — `feat(pack-mode): state root from the pack marker`.

Files: `bin/gstack-state-root.sh`, `lib/state-root.ts`, `bin/gstack-paths`, `test/state-root-parity.test.ts`.

Notes on the plan:

- The bash twin resolves the marker path once, when sourced, from `BASH_SOURCE[0]` with parameter expansion (no subshell), because the file's header promises builtins only and the parity test runs it with an empty `PATH`. A twin sourced by a bare name (found through `PATH`) has no usable directory and ignores the marker.
- `_gstack_sr_var` is `pack_marker` when the marker selects the root; `gstack-paths --explain` prints a `pack marker` row.
- The TS twin takes the marker path as an optional third argument (default `lib/../.gstack-pack-state-root`), so the parity test can point both twins at one temp pack root. The bash side sources a copy of the twin from `<tmp>/render/bin/`.
- Plan dir: the marker branch sits directly after `GSTACK_PLAN_DIR`, ahead of `CLAUDE_PLANS_DIR`, as the PRD orders it.

```
$ bun test test/state-root-parity.test.ts test/state-root-ratchet.test.ts
 42 pass
 0 fail
 116 expect() calls
Ran 42 tests across 2 files. [492.00ms]
```

Related fork suites also green: `test/gstack-paths.test.ts` + `test/uninstall.test.ts` (49 pass), `test/gstack-state-root-override.test.ts`, `test/state-root-config-merge.test.ts`, `test/state-root-one-variable.test.ts`, `test/state-root-resolver-failure.test.ts`, `test/gstack-doctor.test.ts` (37 pass).

End-to-end on a fresh render (`$SP` = a scratch dir, `HOME=$SP/home`, no `GSTACK_*` env, cwd `/`):

```
$ env -i PATH=$HOME/.bun/bin:/usr/bin:/bin HOME=$SP/home bash $SP/r/bin/gstack-paths --explain | head -1
state root: $SP/s (selected by pack_marker)
$ env -i PATH=… HOME=$SP/home CLAUDECODE=1 bash $SP/r/bin/gstack-skill-start --skill test-audit --model claude
SKILL_START_PROTO: 1
STATE_ROOT: $SP/s durable=yes
TELEMETRY: off
UPDATE_CHECK: false
$ find $SP/home
$SP/home
$ ls $SP/s
analytics  config.yaml  projects  sessions
```
