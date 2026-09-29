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
