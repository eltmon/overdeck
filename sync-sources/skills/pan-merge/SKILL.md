---
name: pan-merge
description: "Topical: merge-flow safety guidance, dashboard MERGE behavior, and solo-workflow auto-merge configuration"
triggers:
  - pan merge
  - auto merge
  - dashboard merge
  - merge button
allowed-tools:
  - Read
---

# Merge Flow Guidance

Use the dashboard **MERGE** button for normal issue merges. It runs the managed merge path: rebase, verification, serialized merge, post-merge lifecycle, cleanup, and close-out handoff.

Auto-merge is an opt-in solo-workflow extension of that same managed merge path. Before recommending or enabling it, read [Auto-Merge Configuration](/configuration/auto-merge): it documents every `merge.autoMerge.*` key and explains why shared/team Panopticon instances must not enable it.

## Safety rule

Treat merge consent as a human gate. For solo workflows, the operator may move that gate into configuration plus a cancelable cooldown. For shared workflows, keep the gate at the dashboard MERGE button so the person responsible for the merge explicitly acts at merge time.
