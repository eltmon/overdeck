# PAN-3943 live checkpoint (WI-11)

**Run:** 2026-09-29, on the operator's host, with this branch's build (`node dist/cli/index.js`, built from `feature/pan-3943` after the `cli-deft-verbs` commit).
**Isolation:** `OVERDECK_HOME=<scratch>/home` (a session scratch dir). The real `~/.overdeck/config.yaml` and `projects.yaml` were never written. Every project below is a throwaway repo under `<scratch>`. `directive init` and every other Deft CLI were never run.
**Tools:** Claude Code 2.1.284 (`claude-haiku-4-5-20251001`), codex-cli 0.159.0.
**Pack source:** `https://github.com/eltmon/directive` `master` = `48e8cbf0e7818a2b2ca60a070791e236ca088ac0`, the commit the skill map is verified at.

`$CLI` below is `node <workspace>/dist/cli/index.js`.

## 1. Add the deft pack

```
$ $CLI skills pack add deft https://github.com/eltmon/directive --ref master --yes
Pack deft
  Source       https://github.com/eltmon/directive @ master (48e8cbf)
  Adapter      deft-readonly
  License      MIT
  Skills       7
  Executables  none
  Not applied  hooks, context injection, git hooks, requires CLI (directive)
Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack deft on
Trusted deft @ 48e8cbf.
```

Result: adapter `deft-readonly`, `Skills 7`, and the four Not-applied labels. **Pass.**

## 2. Claude Code sees `deft:glossary` (D10)

```
$ $CLI skills set --pack deft on
deft (pack): on at global
$ $CLI skills launch-settings --harness claude-code --cwd <scratch>/plain --plugin-link $OVERDECK_HOME/launch/chk/skill-packs
stdout: {"permissions":{"deny":["Bash(directive:*)","Bash(deft:*)","Bash(deft-hook:*)","Bash(npx @deftai/directive:*)","Bash(npm install @deftai/directive:*)","Bash(npm i @deftai/directive:*)","Bash(pnpm add @deftai/directive:*)","Bash(git config core.hooksPath:*)"]}}
stderr: [launcher] deft: pack master (48e8cbf0e781); project not directive; read-only
```

The mount holds `deft/skills/{cost,debug,design-critique,gh-arch,glossary,probe,write-skill}`, and `glossary/SKILL.md` starts `---\nname: glossary\n`, followed by the host notice.

```
$ claude -p --model claude-haiku-4-5-20251001 --settings "<stdout above>" --plugin-dir $OVERDECK_HOME/launch/chk/skill-packs \
    "List every available skill whose name contains glossary, with its exact full name as it appears in your skill list. Do not run any tools."
Based on the skill list in the system reminder, there is one skill whose name contains "glossary":

- `deft:glossary`
```

Result: `deft:glossary`, never `deft:deft-directive-glossary`. The frontmatter rename works, so no D10 fallback is needed. **Pass.**

## 3. Codex sees `deft:glossary`

```
$ $CLI skills launch-settings --harness codex --cwd <scratch>/plain --codex-home <scratch>/ch
stderr: [launcher] deft: pack master (48e8cbf0e781); project not directive; read-only
$ CODEX_HOME=<scratch>/ch codex debug prompt-input "hi" | grep -o "deft:[a-z-]*" | sort -u
deft:cost
deft:debug
deft:design-critique
deft:gh-arch
deft:glossary
deft:probe
deft:write-skill
$ grep -c deft-directive-glossary <prompt input>
0
```

No `overdeck-deft.env` was written (non-Directive project). **Pass.**

## 4. Claude `--settings` deny (WI-8 implementation checkpoint)

Run in a scratch dir under `--permission-mode bypassPermissions`, so only a deny rule can block the call:

```
$ claude -p --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions --output-format json \
    --settings '{"permissions":{"deny":["Bash(deft:*)"]}}' "Run the shell command: deft --version"
permission_denials: [{"tool_name": "Bash", "tool_input": {"command": "deft --version", ...}}]
result: The permission to run `deft --version` was denied. ...

$ claude -p ... --permission-mode bypassPermissions --output-format json "Run the shell command: deft --version"   # control, no deny
permission_denials: []
result: The `deft` command is not found on this system. ...
```

Result: the `--settings` deny applies even under bypassPermissions; the control ran the command. `permissions.deny` stays in the settings JSON; the fallback was not needed. **Pass.**

## 5. Non-Directive repo stays clean

After steps 2 and 3 in `<scratch>/plain` (a committed git repo):

```
$ git -C <scratch>/plain status --porcelain
(empty)
```

**Pass.**

## 6. Directive fixture: issue-level off in a `feature-tst-1` worktree

Fixture (markers only, hand-built): project `<scratch>/proj` registered as `tst` with `issue_prefix: TST` in the isolated `projects.yaml`; worktree `<scratch>/proj/workspaces/feature-tst-1`, a git repo with committed `AGENTS.md` (`<!-- deft:managed-section v3 -->`), `package.json` (`"@deftai/directive": "^0.119.10"`), `.claude/settings.json` (a `deft-hook` command), and `.claude/skills/deft-directive-glossary/SKILL.md`.

```
$ $CLI skills set --pack deft off --issue TST-1
deft (pack): off at issue TST-1 (committed bcab18f, push pending: main has no upstream)
$ $CLI skills launch-settings --harness claude-code --cwd <wt> --plugin-link $OVERDECK_HOME/launch/chk6/skill-packs
stdout: {"skillOverrides":{"deft-directive-glossary":"off"}}
stderr: [launcher] deft: pack off; project directive engine ^0.119.10; kill switch
$ cat $OVERDECK_HOME/launch/chk6/deft.env        # mode 600
DEFT_DIRECTIVE_DISABLE=1
$ cat <wt>/.deft-directive-disable
# overdeck:deft-directive-disable
# Remove with: pan skills set --pack deft inherit --issue TST-1
$ tail -1 <wt>/.git/info/exclude
/.deft-directive-disable
$ git -C <wt> status --porcelain
(empty)
```

The launcher's allowlisted read of that env file, run in a clean `env -i` bash, exports exactly `DEFT_DIRECTIVE_DISABLE=1`.

```
$ $CLI skills set --pack deft inherit --issue TST-1
$ $CLI skills launch-settings --harness claude-code --cwd <wt> --plugin-link $OVERDECK_HOME/launch/chk6/skill-packs
stdout: (empty)
stderr: [launcher] deft: pack master (48e8cbf0e781); project directive engine ^0.119.10; untouched
flag exists: no; env file exists: no
$ git -C <wt> status --porcelain
(empty)
```

Result: marked flag written, env file holds `DEFT_DIRECTIVE_DISABLE=1`, the pointer skill is hidden, `git status` stays empty, and `inherit` removes the flag and the env file. No deny list in a Directive project. **Pass.**

### 6b. Managed mode (extra, not in the PRD list)

`enable` inspects the registered project root. The first attempt refused (`tst is not a Directive project; Overdeck never runs directive init`) because the fixture had markers only in the worktree; a real deposit is tracked, so the primary checkout has it too. After committing the same `AGENTS.md` and `package.json` to `<scratch>/proj`:

```
$ $CLI skills deft enable --project tst < /dev/null
Not written: re-run with --yes to accept plan 1cc7ea234726.          (exit 1)
$ $CLI skills deft enable --project tst --yes
Managed mode on for tst (plan 1cc7ea234726); applies at next launch.
projects.yaml: deft_integration: { mode: managed, plan_digest: 1cc7ea23…191b, enabled_at: 2026-09-29T23:26:29.256Z }
$ (launch step in <wt>)
stderr: [launcher] deft: pack master (48e8cbf0e781); project directive engine ^0.119.10; managed
deft.env: DEFT_ORCHESTRATOR=overdeck
$ $CLI skills deft disable --project tst
Managed mode off for tst; project files untouched.
(launch step again) env file exists: no; git status --porcelain empty in both repos
```

**Pass.**

## 7. Cleanup

```
$ $CLI skills set --pack deft off
deft (pack): off (default) at global
$ $CLI skills pack gc --max-age-days 0
Removed 0 mount(s) and 0 dangling launch link(s).
```

The issue and project levels were already back to inherit, and managed mode was off. `gc` removed nothing because the checkpoint's launch links still reference their mounts. The whole isolated home is disposable scratch.
