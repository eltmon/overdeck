# PAN-4334 live checkpoint (PRD §14 WI-18, §10 AC-5)

**Deviation from the PRD, stated first.** The checkpoint ran on this host but under an isolated
`OVERDECK_HOME` (a scratch directory) with a throwaway project `tst` (prefix `TST`, plan home = a
temp git repo with no upstream), using this branch's build (`node dist/cli/index.js`, shown as
`pan` below). Reasons:

- The deployed `pan` predates this branch, so neither `pan skills pack` nor the launcher's
  `--plugin-link` step exists there until merge and `pan reload`.
- Turning the pack on in the real `~/.overdeck/config.yaml` would have applied it to every agent
  launched on this host during the window.
- An issue-level toggle on a real project commits and pushes to `main` of its plan home.

AC-5.4 therefore ran as a standalone interactive `claude --plugin-dir` in a throwaway tmux pane,
not as a managed launch. **The operator should repeat AC-5.4 with a managed Claude Code launch
after this merges and `pan reload` ships it.** The real pack was not registered in the host
config.

Results: AC-5.1 pass, AC-5.2 pass (primary Codex route; no fallback needed), AC-5.3 pass,
AC-5.4 (substitute) pass with no consent dialog, cleanup leaves the pack off with source `default`.

## Setup (isolated OVERDECK_HOME)

```text
$ node dist/cli/index.js skills pack add mattpocock https://github.com/mattpocock/skills --ref v1.2.3 --yes
Pack mattpocock
  Source       https://github.com/mattpocock/skills @ v1.2.3 (6acc160)
  Adapter      claude-plugin
  License      MIT
  Skills       25 (1 opt-in: setup-matt-pocock-skills)
  Executables  skills/engineering/diagnosing-bugs/scripts/hitl-loop.template.sh, skills/engineering/wizard/template.sh
  Not applied  executables (2), project-mutating skills (1)
Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack mattpocock on
Trusted mattpocock @ 6acc160.

$ node dist/cli/index.js skills set --pack mattpocock on
mattpocock (pack): on at global

```

## AC-5.1 Claude Code --plugin-dir

```text
exit=0 settings=[]
<scratch>/home/packs/mounts/07b7bc2c59a844af2f0e39c300c996ddd72787fc8d02f0f00994ec1b964f93c3/plugins
ask-matt code-review codebase-design diagnosing-bugs domain-modeling grill-me grill-with-docs grilling handoff implement improve-codebase-architecture prototype research resolving-merge-conflicts tdd teach to-questionnaire to-spec to-tickets triage wait-what wayfinder wizard writing-for-agents 
grilling SKILL.md present
mounted skills: 24
$ claude -p --model claude-haiku-4-5-20251001 ${PAN_SKILL_SETTINGS:+--settings ...} --plugin-dir "$link" "List every available skill whose name contains grilling ..."
Permission deny rule (../../.claude/settings.local.json): Write(.claude/agents/**) is not matched by file permission checks — only Edit(path) rules are. Use Edit(.claude/agents/**) instead (Edit rules cover all file-editing tools).
Permission deny rule (../../.claude/settings.local.json): Write(.claude/hooks/**) is not matched by file permission checks — only Edit(path) rules are. Use Edit(.claude/hooks/**) instead (Edit rules cover all file-editing tools).
grilling
mattpocock:grilling
exit=0
```

## AC-5.2 Codex local marketplace

```text
launch-settings exit=0
$ cat $CODEX_HOME/config.toml
# overdeck:skill-packs:begin
[marketplaces.overdeck-packs]
source_type = "local"
source = "<scratch>/home/packs/mounts/07b7bc2c59a844af2f0e39c300c996ddd72787fc8d02f0f00994ec1b964f93c3"

[plugins."mattpocock@overdeck-packs"]
enabled = true
# overdeck:skill-packs:end
07b7bc2c59a844af2f0e39c300c996ddd72787fc8d02f0f00994ec1b964f93c3
$ CODEX_HOME=$tmp/ch codex debug prompt-input "hi" | grep -o "mattpocock:grilling[^\"]*"
codex exit=0
mattpocock:grilling: Grill the user relentlessly about a plan, decision, or idea. Use when the user want (file: r2/grilling/SKILL.md)
file: r2/grilling/SKILL.md
Codex root alias r2 = <CODEX_HOME>/plugins/cache/overdeck-packs/mattpocock/07b7bc2c…93c3/skills (the per-agent cache copy)

```

## AC-5.3 issue-level pack off

```text
link present before: yes
$ node dist/cli/index.js skills set --pack mattpocock off --issue TST-1
mattpocock (pack): off at issue TST-1 (committed ac133b2, push pending: main has no upstream)

$ git -C <scratch>/repo log --oneline -1
ac133b2 chore(workspace): skill overrides for TST-1

$ cat <scratch>/repo/.pan/skill-overrides/TST-1.yaml
# Overdeck per-issue skill overrides (PAN-3942). true = on, false = off; absent = inherit.
issue: TST-1
packs:
  mattpocock: false

$ node dist/cli/index.js skills launch-settings --harness claude-code --cwd /home/eltmon/Projects/overdeck/workspaces/feature-pan-4334 --issue TST-1 --plugin-link <scratch>/tmp/link

[ ! -e "$tmp/link" ] → exit 0 (link removed)
PAN_SKILL_PLUGIN_DIR=[]  claude argv: claude
Contrast, same launcher lines with no issue (global pack on):
claude argv: claude --plugin-dir <scratch>/tmp/link

```

## AC-5.4 (substitute) interactive claude --plugin-dir in a throwaway tmux pane

```text
$ tmux -L pan4334-probe new-session -d ... "claude --model claude-haiku-4-5-20251001 --plugin-dir <link> \"List every available skill whose name contains grilling ...\""
 ▐▛███▛█   Claude Code v2.1.280
▝▜██████▀  Haiku 4.5 · Claude Max
  ▝▝ ▝▝    ~/Projects/overdeck/workspaces/feature-pan-4334
❯ List every available skill whose name contains 'grilling', exactly as named in your skill list, one per line. Do not invoke any tools.
● grilling
  mattpocock:grilling
✻ Worked for 19s · done 10:05 PM
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 

No plugin-consent or trust dialog appeared; the pane reached the input prompt.

```

## Cleanup

```text
$ node dist/cli/index.js skills set --pack mattpocock off
mattpocock (pack): off (default) at global

$ node dist/cli/index.js skills set --pack mattpocock inherit --issue TST-1
mattpocock (pack): inherit at issue TST-1 (committed 62d04f4, push pending: main has no upstream)

$ node dist/cli/index.js skills pack list --json --offline
[
  {
    "id": "mattpocock",
    "url": "https://github.com/mattpocock/skills",
    "ref": "v1.2.3",
    "commit": "6acc160e4e0cd062dbbbd7a1b26ae92855edf07e",
    "adapter": "claude-plugin",
    "cached": true,
    "license": "MIT",
    "skills": 25,
    "notApplied": [
      "executables (2)",
      "project-mutating skills (1)"
    ]
  }
]

$ node dist/cli/index.js skills pack gc --max-age-days 0
Removed 1 mount(s) and 0 dangling launch link(s).

$ pan skills list | grep -A3 "Skill packs"
Skill packs (1)

mattpocock                                  off    default
  mattpocock/ask-matt                       off    default
  mattpocock/code-review                    off    default
```
