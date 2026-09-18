---
name: write-spec
description: "Compatibility redirect: /write-spec has been renamed to /pan-plan"
triggers:
  - write spec
  - write-spec
  - create spec
  - feature spec
allowed-tools: []
---

# /write-spec renamed to /pan-plan

This compatibility stub preserves the former skill name. Use `/pan-plan` to start issue planning.

PRDs are written to `drafts/<issue>.md` on `overdeck-state` following the `prd-authoring` rule; the `docs/prds/` directories are retired.

If this skill is invoked, stop reading this file and invoke `/pan-plan` so the current planning flow, xBRIEF schema, and finalization guidance load.

Do not write a spec from this stub. The canonical instructions live in `sync-sources/skills/pan-plan/SKILL.md`.
