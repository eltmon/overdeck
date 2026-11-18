---
name: pan-skills
description: "pan skills — turn skills and skill packs on or off, and add known skill packs when a requested skill is missing: the video group (Remotion, HyperFrames, OpenMontage, video-use), pstack, atlassian, sageox, gstack, mattpocock, deft"
triggers:
  - skill is missing
  - skill not installed
  - add the video skills
  - install remotion or hyperframes skills
  - add a skill pack
allowed-tools:
  - Bash
  - Read
---

# Skills and skill packs

`pan skills` lists skills, turns skills and skill packs on or off at the global, project or issue level, and manages skill packs: git repositories of skills that Overdeck pins to a trusted commit.

## When a skill you need is missing

If the user asks for a skill that is not in your skill list (for example `hyperframes`, `remotion`, `media-use` or `video-use`), it may belong to a known pack that is not added on this machine. Run:

```bash
pan skills pack list --offline
```

It prints "Known packs not added" with the exact command that adds each one, and each pack group's members that are not added. Tell the user which pack holds the skill and offer to add it. After they agree, run the command. Adding a pack trusts a pinned commit and turns nothing on.

## Known packs

| Pack | What it holds | Default ref pinned | Group |
| --- | --- | --- | --- |
| `remotion` | Remotion video skills | yes | `video` |
| `hyperframes` | HyperFrames (HTML-to-video) skills, including media-use and figma | yes | `video` |
| `openmontage` | OpenMontage video production and provider skills | yes | `video` |
| `video-use` | video-use editing skill (transcribes with ElevenLabs Scribe) | yes | `video` |
| `pstack` | pstack workflow skills (Claude Code build) | yes | none |
| `atlassian` | Atlassian Rovo MCP plugin skills for Jira and Confluence | yes | none |
| `sageox` | SageOx session recording skills; adding it builds `ox` | yes | none |
| `gstack` | gstack skills and runtime; adding it runs its setup | no | none |
| `mattpocock` | Matt Pocock's skills | no | none |
| `deft` | Deft Directive skills (read-only) | no | none |

The `video` group is `remotion`, `hyperframes`, `openmontage` and `video-use`. Operators can add groups in `~/.overdeck/config.yaml` under `skills.pack_groups`.

## Add, enable, load

1. **Add** the pack (registers the pinned commit):

   ```bash
   pan skills pack add --group video --yes
   pan skills pack add remotion --yes
   ```

2. **Enable** it (global; add `--project <key>` for one project):

   ```bash
   pan skills set --group video on
   pan skills set --pack remotion on
   ```

3. **Load** it into this running conversation:

   ```bash
   pan skills add self --pack remotion --pack hyperframes --pack openmontage --pack video-use
   ```

`mattpocock`, `deft` and `gstack` need a ref: `pan skills pack add gstack --ref <ref>`. Adding `sageox` builds `ox` and adding `gstack` runs its setup, so both can take minutes. A managed agent can also use the `add_skills` tool for step 3. The operator can add the same packs from the dashboard: Skills page, then Available packs, then **Add…**.

## Other commands

```bash
pan skills list
pan skills set grilling on
pan skills set --pack remotion off
pan skills pack update remotion
pan skills pack remove remotion
pan skills pack sync remotion
```
