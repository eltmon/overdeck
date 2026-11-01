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

## Fork: pack-mode test

Fork commit: `541f9683409d7fd21e55beeb310c5bae7f0bdad1` — `test(pack-mode): pack mode writes only its two roots`.

Files: `test/pack-mode.test.ts` (new), `docs/pack-mode.md` (new), `docs/state-root.md` (one added row: the pack marker in the chain table, so the state-root doc matches the resolvers changed in `fork-state-root-marker`).

Notes on the plan:

- Git stub: the PRD lists `remote` among the network subcommands. `gstack-skill-start` runs `git remote get-url origin`, which only reads local config, so a blanket `remote` rule logged a false network call. The stub treats only `remote update` and `remote show` as network. With that, the test also asserts that `net.log` is still absent after `gstack-skill-start`, which is stricter than the PRD's setup-only check.
- Extra case beyond the PRD list: a non-empty `--pack-root` exits 2 and leaves its contents alone.

```
$ bun test test/pack-mode.test.ts
bun test v1.3.14 (0d9b296a)

 4 pass
 0 fail
 26 expect() calls
Ran 4 tests across 1 file. [643.00ms]
```

Registry ratchets for new test files also pass: `test/free-seed-ratchet.test.ts`, `test/test-free-shards.test.ts`, `test/free-fixtures.test.ts` (98 pass).

## Fork: publish

Branch `overdeck/pack-mode` pushed to `https://github.com/eltmon/gstack`. PR opened inside the fork with `gh pr create --repo eltmon/gstack --base main --head overdeck/pack-mode`; not merged (operator's call). No upstream contact.

PR: https://github.com/eltmon/gstack/pull/1

**Pack-mode SHA** (used by the live acceptance): `541f9683409d7fd21e55beeb310c5bae7f0bdad1`

```
$ gh pr view --repo eltmon/gstack overdeck/pack-mode --json baseRefName,headRefName,state,isCrossRepository,url
{"baseRefName":"main","headRefName":"overdeck/pack-mode","isCrossRepository":false,"state":"OPEN","url":"https://github.com/eltmon/gstack/pull/1"}
```

## Fork: review fix (operator)

The operator's review of eltmon/gstack#1 found that pack mode wrote bun's transpiler cache to `$HOME/.bun/install/cache/@t@/*.pile` (reproduced here: `env -i HOME=<empty> … bash setup --pack-root R --pack-state-root S` left 5 `.pile` files; `gstack-skill-start` added none). My `test/pack-mode.test.ts` missed it because it redirected `BUN_INSTALL` and `XDG_CACHE_HOME` out of the temp HOME.

Fork commit: `85aa244e5b7cb9d755ec50e831be32e2a14a85e6` — `fix(pack-mode): keep bun's transpiler cache out of HOME`. `scripts/pack-render.sh` runs the generator with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`; the test now starts from an empty HOME with bun's defaults and asserts `tree(home)` is `{}` after each render and after `gstack-skill-start`.

```
$ bun test test/pack-mode.test.ts          # with the env var removed from pack-render.sh
(fail) setup pack mode > renders into R and S only, rewrites the install root, and runs the rendered runtime from S
(fail) setup pack mode > a second render keeps an existing S/config.yaml byte for byte
 2 pass
 2 fail
$ bun test test/pack-mode.test.ts          # with the fix
 4 pass
 0 fail
```

Pushed to `overdeck/pack-mode`; PR body updated with a "Review fix" section. Not merged (the operator merges). **Pack-mode SHA is now `85aa244e5b7cb9d755ec50e831be32e2a14a85e6`.**

## Live acceptance

Run 2026-11-01 from this workspace's build (`npm run build`, rc 0), `P=node /home/eltmon/Projects/overdeck/workspaces/feature-pan-4727/dist/cli/index.js`, with `OVERDECK_HOME=/tmp/pan-4727-live/overdeck-home` written inline on every `$P` command. No `pan up`, `pan start` or dashboard command used the isolated home. Before step 3: `~/.gstack` and `~/.claude/skills/gstack` did not exist and no `GSTACK_*` variable was set.

Deviations from the PRD steps:

- Step 5: the PRD's `--harness claude` is rejected (`unsupported harness: claude`); the command takes `claude-code`.
- Step 6: `--allowedTools` is variadic, so a prompt placed after it was read as a tool name (`Error: Input must be provided …`, nothing ran). The prompt now comes right after `-p`. The probes ran with this session's `CLAUDE*` variables unset (`env -u CLAUDECODE -u CLAUDE_CODE_* -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_PLUGIN_DATA …`). The slash form `/gstack:…` worked; the prose fallback was not needed.
- Steps 4-6 ran at `541f9683`. The operator's review fix (`85aa244e`) arrived during the run; step 7b moved the isolated pack to it with `pack update`, and steps 8-9 ran at `85aa244e`. The two renders differ only by the render path embedded in the skills and the fixed `scripts/pack-render.sh` (`diff -rq` lists only `SKILL.md`, `sections/*` and `scripts/pack-render.sh`), so the step-6 probes were not repeated.
- Step 7: the `ls -la ~/.claude/skills | sha256sum` line changed. The cause is not gstack: the listing includes the `..` entry (`~/.claude` mtime moved to 13:31 because Claude Code writes there), and Claude Code's own synced-skill folder `~/.claude/skills/synced/ec6dae55-…/` (`manifest.json`, `.last-complete-round`) was updated during the run. `~/.claude/skills` itself kept its mtime (Oct 24), no entry named `*gstack*` exists, and the PRD's `find ~/.claude -newer start -path '*gstack*'` check printed nothing. `~/.claude/settings.json` is byte-identical.

### Steps 1-3

```
$ git clone --quiet --no-hardlinks /home/eltmon/Projects/overdeck/workspaces/feature-pan-4727 /tmp/pan-4727-live/project
$ cat $OVERDECK_HOME/projects.yaml
projects:
  live:
    name: live
    path: /tmp/pan-4727-live/project
    issue_prefix: LIVE
$ cat /tmp/pan-4727-live/before.txt
6306dc702170a848544c7d47e02483a42cb0aec999709bd7c38db33c349b8471  /home/eltmon/.claude/settings.json
1654fe7004c7303ac04c3400bc6c9791852ec49c0eb81abca041ad40349aea61  -
$ test ! -e ~/.gstack && echo "no ~/.gstack"
no ~/.gstack
$ OVERDECK_HOME=… $P skills pack list --offline
No skill packs. Add one with: pan skills pack add mattpocock https://github.com/eltmon/skills --ref v1.2.3
```

### Step 4: add

```
$ OVERDECK_HOME=… $P skills pack add gstack https://github.com/eltmon/gstack --ref 541f9683409d7fd21e55beeb310c5bae7f0bdad1 --yes
Pack gstack
  Source       https://github.com/eltmon/gstack @ 541f9683409d7fd21e55beeb310c5bae7f0bdad1 (541f968)
  Adapter      gstack-runtime
  License      MIT
  Skills       36 (14 opt-in: autoplan, benchmark-models, captain, careful, codex, cso, document-generate, document-release, eval-plan, freeze, guard, modernize, ubicloud, unfreeze)
  Not mounted  27: benchmark (Calls $B, $D or $P, which pack mode does not build (PAN-4730).); browse (…); canary (…); connect-chrome (Symlink alias; symlinked skills are never mounted.); … gstack-upgrade (Runs git reset --hard on the install; Overdeck pins commits.); … plan-tune (Needs setup's PreToolUse/PostToolUse hooks, which pack mode does not install.); … setup-deploy (Edits CLAUDE.md and needs $B.); setup-gbrain (Runs claude mcp add and edits CLAUDE.md.); … sync-gbrain (Edits CLAUDE.md and pushes the brain repo.)
  Runs         bash setup --pack-root /tmp/pan-4727-live/overdeck-home/packs/gstack/render/541f9683409d7fd21e55beeb310c5bae7f0bdad1 --pack-state-root /tmp/pan-4727-live/overdeck-home/packs/gstack/state
  Executables  232 files the mounted skills can run:
  Not applied  hooks, agents, project-mutating skills (14), requires CLI (bun)
  Requires     bun
                autoplan/bin/phase-publication-hook
                bin/dev-setup
                …                                   (232 lines, one per file, none elided)
                supabase/verify-rls.sh
Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack gstack on
Trusting runs the command above once now; skills run the listed scripts when you invoke them.
Trusted gstack @ 541f968.
$ cat $OVERDECK_HOME/packs/gstack/render/541f9683409d7fd21e55beeb310c5bae7f0bdad1/.gstack-pack.json
{"packMode":1,"stateRoot":"/tmp/pan-4727-live/overdeck-home/packs/gstack/state","version":"1.92.33.0"}
```

(The `Not mounted` line is shortened here with `…`; the real line names all 27 skills with reasons.)

### Step 5: on for the project

```
$ OVERDECK_HOME=… $P skills set --pack gstack on --project live
gstack (pack): on at project live
$ OVERDECK_HOME=… $P skills launch-settings --harness claude-code --cwd /tmp/pan-4727-live/project --plugin-link /tmp/pan-4727-live/link
[launcher] deft: pack off; project not directive; read-only
$ ls /tmp/pan-4727-live/link/gstack/skills
context-restore context-save design-motion deslop-shared-libs diagram health investigate ios-clean ios-design-review ios-fix ios-qa ios-sync landing-report learn plan-ceo-review plan-devex-review plan-eng-review retro review test-audit verify write-skill
test-audit: present / deslop-shared-libs: present / qa: absent / codex: absent
$ grep -n "gstack-skill-start --skill" /tmp/pan-4727-live/link/gstack/skills/test-audit/SKILL.md
29:/tmp/pan-4727-live/overdeck-home/packs/gstack/render/541f9683409d7fd21e55beeb310c5bae7f0bdad1/bin/gstack-skill-start --skill "test-audit" --model "claude"
```

### Step 6: the skills run

```
$ cd /tmp/pan-4727-live/project && env -u CLAUDECODE … GSTACK_SESSION_KIND=spawned claude -p "/gstack:test-audit Audit only src/lib/skill-packs/__tests__ and report; do not edit files." --plugin-dir /tmp/pan-4727-live/link --output-format stream-json --verbose --allowedTools "Bash Read Grep Glob Write Edit" > test-audit.jsonl
result: {'subtype': 'success', 'is_error': False, 'num_turns': 24, 'duration_ms': 321837, 'total_cost_usd': 3.18}
test-audit.jsonl contains: SKILL_START_PROTO: 1
test-audit.jsonl contains: STATE_ROOT: /tmp/pan-4727-live/overdeck-home/packs/gstack/state
result text (start): "I audited `src/lib/skill-packs/__tests__` (6 files, 99 test cases). … The report is at `/tmp/pan-4727-live/overdeck-home/packs/gstack/state/projects/workspaces-feature-pan-4727/test-audit-20261101-132054.md`, with a `.json` copy next to it."

$ … claude -p "/gstack:deslop-shared-libs Scan src/lib/skill-packs only and report; do not edit files." … > deslop.jsonl
result: {'subtype': 'success', 'is_error': False, 'num_turns': 26, 'duration_ms': 392670, 'total_cost_usd': 2.98}
result text (start): "I made no file edits and ran no project code. Three sharing opportunities hold up. …"
```

The init event of the run listed 22 `gstack:*` slash commands. `deslop-shared-libs` read history through `gh api` (its own design) and reported that gstack's safe-git wrapper needs a git newer than this host's 2.43 (`--no-lazy-fetch`), so it fell back to the GitHub API. That is a gstack limitation on this host, not an Overdeck one.

### Step 7: nothing written outside the pack

```
$ diff /tmp/pan-4727-live/before.txt /tmp/pan-4727-live/after.txt
2c2
< 1654fe7004c7303ac04c3400bc6c9791852ec49c0eb81abca041ad40349aea61  -
---
> e1cc9b43557327668e920501fb4db215c07286b0851241197ebce2f142fd136e  -
   (line 1, ~/.claude/settings.json, unchanged; line 2 explained under Deviations: the `..` entry and Claude Code's own skills/synced/ folder)
$ find ~/.claude/skills \( -newer start -o -cnewer start \)
/home/eltmon/.claude/skills/synced/ec6dae55-c793-4cf2-a2de-5fb479e83e5e_bc8c7f74-dc5d-4f2a-9979-6ea71fe618fd
/home/eltmon/.claude/skills/synced/ec6dae55-…/manifest.json
/home/eltmon/.claude/skills/synced/ec6dae55-…/.last-complete-round
$ test ! -e ~/.gstack && echo "no ~/.gstack"
no ~/.gstack
$ find ~/.claude -newer /tmp/pan-4727-live/start -path '*gstack*' -not -path '*/.claude/plugins/*' -not -path '*/.claude/projects/*'
(no output)
$ ls $OVERDECK_HOME/packs/gstack/state
analytics  config.yaml  projects  sessions  slug-cache
```

### Step 7b: move to the review-fix commit (FR-11)

```
$ OVERDECK_HOME=… $P skills pack update gstack --ref 85aa244e5b7cb9d755ec50e831be32e2a14a85e6 --yes
  Source       https://github.com/eltmon/gstack @ 85aa244e5b7cb9d755ec50e831be32e2a14a85e6 (85aa244)
  Runs         bash setup --pack-root /tmp/pan-4727-live/overdeck-home/packs/gstack/render/85aa244e5b7cb9d755ec50e831be32e2a14a85e6 --pack-state-root /tmp/pan-4727-live/overdeck-home/packs/gstack/state
  Previous     541f968
  Added        none
  Removed      none
  Changed      none
  New          none
Trusted gstack @ 85aa244.
$ diff -rq render/541f9683… render/85aa244e… | grep -v 'SKILL.md\|sections/'
Files …/scripts/pack-render.sh differ
```

### Step 8: off removes gstack from the next launch

```
$ OVERDECK_HOME=… $P skills launch-settings --harness claude-code --cwd /tmp/pan-4727-live/project --plugin-link /tmp/pan-4727-live/link
on: /tmp/pan-4727-live/overdeck-home/packs/mounts/a68d12c5…/plugins   (test-audit present, from the 85aa244e render)
$ OVERDECK_HOME=… $P skills set --pack gstack inherit --project live
gstack (pack): inherit at project live
$ OVERDECK_HOME=… $P skills launch-settings --harness claude-code --cwd /tmp/pan-4727-live/project --plugin-link /tmp/pan-4727-live/link
[launcher] deft: pack off; project not directive; read-only
$ test ! -e /tmp/pan-4727-live/link && echo "link absent"
link absent
```

### Step 9: remove leaves nothing

```
$ OVERDECK_HOME=… $P skills pack remove gstack
Removed pack gstack, its cache, 2 mount(s) and 0 Codex cache(s).
Project files gstack skills wrote (not removed): /tmp/pan-4727-live/project/.gstack  — remove with: rm -rf /tmp/pan-4727-live/project/.gstack
$ find $OVERDECK_HOME -path '*gstack*'
(no output)
$ ls $OVERDECK_HOME/packs $OVERDECK_HOME/packs/mounts
packs: mounts      mounts: (empty)
$ test -d /tmp/pan-4727-live/project/.gstack && echo "project .gstack kept"
project .gstack kept          (contents: .gstack/tmp/, written by the invoked skills)
$ test ! -e ~/.gstack && echo "no ~/.gstack"
no ~/.gstack
$ sha256sum ~/.claude/settings.json
6306dc702170a848544c7d47e02483a42cb0aec999709bd7c38db33c349b8471  /home/eltmon/.claude/settings.json
```

### Step 10

`rm -rf /tmp/pan-4727-live` after this section was written.
