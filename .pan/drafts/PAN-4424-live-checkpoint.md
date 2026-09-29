# PAN-4424 live verification checkpoint

## Setup

```
$ pan skills pack add mattpocock https://github.com/eltmon/skills --ref v1.2.3 --yes
Pack mattpocock
  Source       https://github.com/eltmon/skills @ v1.2.3 (6acc160)
  Adapter      claude-plugin
  License      MIT
  Skills       25 (1 opt-in: setup-matt-pocock-skills)
  Executables  skills/engineering/diagnosing-bugs/scripts/hitl-loop.template.sh, skills/engineering/wizard/template.sh
  Not applied  executables (2), project-mutating skills (1)
Adding a pack trusts this commit and enables nothing. Turn it on with: pan skills set --pack mattpocock on
Trusted mattpocock @ 6acc160.
```

```
$ pan skills pack list --offline --json
[
  {
    "id": "mattpocock",
    "url": "https://github.com/eltmon/skills",
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
```

```
$ pan skills list | grep -A2 "Skill packs"
Skill packs (1)

mattpocock                                  off    default
```

## Levels (launch step)

WS = `/home/eltmon/Projects/overdeck/workspaces/feature-pan-4424` (resolves to project `panopticon-cli`).

### Global

```
$ pan skills set --pack mattpocock on
mattpocock (pack): on at global

$ pan skills launch-settings --harness claude-code --cwd "$WS" --plugin-link <scratch>/global-link
$ find -L <scratch>/global-link -name SKILL.md | wc -l
24
$ find -L <scratch>/global-link -path '*setup-matt-pocock-skills*'
(no output)

$ pan skills launch-settings --harness codex --cwd "$WS" --codex-home <scratch>/global-ch
$ grep -A1 'plugins."mattpocock@overdeck-packs"' <scratch>/global-ch/config.toml
[plugins."mattpocock@overdeck-packs"]
enabled = true

$ pan skills set --pack mattpocock off
mattpocock (pack): off (default) at global
```

### Project (`panopticon-cli`)

```
$ pan skills set --pack mattpocock on --project panopticon-cli
mattpocock (pack): on at project panopticon-cli

$ pan skills launch-settings --harness claude-code --cwd "$WS" --plugin-link <scratch>/project-link
$ find -L <scratch>/project-link -name SKILL.md | wc -l
24
$ find -L <scratch>/project-link -path '*setup-matt-pocock-skills*'
(no output)

$ pan skills launch-settings --harness codex --cwd "$WS" --codex-home <scratch>/project-ch
$ grep -A1 'plugins."mattpocock@overdeck-packs"' <scratch>/project-ch/config.toml
[plugins."mattpocock@overdeck-packs"]
enabled = true

$ pan skills set --pack mattpocock inherit --project panopticon-cli
mattpocock (pack): inherit at project panopticon-cli
```

### Issue (PAN-4424)

```
$ pan skills set --pack mattpocock on --issue PAN-4424
mattpocock (pack): on at issue PAN-4424 (committed f712420, pushed)

$ pan skills launch-settings --harness claude-code --cwd "$WS" --issue PAN-4424 --plugin-link <scratch>/issue-link
$ find -L <scratch>/issue-link -name SKILL.md | wc -l
24
$ find -L <scratch>/issue-link -path '*setup-matt-pocock-skills*'
(no output)

$ pan skills launch-settings --harness codex --cwd "$WS" --issue PAN-4424 --codex-home <scratch>/issue-ch
$ grep -A1 'plugins."mattpocock@overdeck-packs"' <scratch>/issue-ch/config.toml
[plugins."mattpocock@overdeck-packs"]
enabled = true
```

Kept on for WI-6/WI-7 (reverted in WI-7 cleanup).

### Narrowing check (issue beats global)

```
$ pan skills set --pack mattpocock on
mattpocock (pack): on at global

$ pan skills set --pack mattpocock off --issue PAN-4424
mattpocock (pack): off at issue PAN-4424 (committed 6630b10, pushed)

$ pan skills launch-settings --harness claude-code --cwd "$WS" --issue PAN-4424 --plugin-link <scratch>/narrow-link
$ [ ! -e <scratch>/narrow-link ]; echo $?
0

$ pan skills set --pack mattpocock off
mattpocock (pack): off (default) at global

$ pan skills set --pack mattpocock on --issue PAN-4424
mattpocock (pack): on at issue PAN-4424 (committed ac73d32, pushed)
```

### End-of-item state

```
$ pan skills list | grep -A3 "Skill packs"
Skill packs (1)

mattpocock                                  off    default
  mattpocock/ask-matt                       off    default

$ pan skills list --project panopticon-cli | grep -A3 "Skill packs"
Skill packs (1)

mattpocock                                  off    default
  mattpocock/ask-matt                       off    default

$ pan skills list --issue PAN-4424 | grep -A3 "Skill packs"
Skill packs (1)

mattpocock                                  on     issue
  mattpocock/ask-matt                       on     issue-pack
```
