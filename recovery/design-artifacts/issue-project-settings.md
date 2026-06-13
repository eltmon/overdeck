## Problem

When you open/click into a project in the dashboard, there is **no clearly-visible section for that project's settings**. A user looking to configure a project (repos, services, DNS/Docker, and — newly relevant — the project's default merge policy) has nowhere obvious to go. Project config today lives in `projects.yaml` and the global Settings page, not surfaced per-project in the project view.

## How it came up

Surfaced while building the per-issue auto-merge toggle ([PAN-1692](https://github.com/eltmon/panopticon-cli/issues/1692)). The toggle has a "default" state ("follow the project default"), and the natural question — *where do I set that default?* — has no discoverable home in the project view.

## Ask

Add a clearly-visible **project-settings section/panel** reachable from the project view (when a project is selected/expanded in the resource tree). It should surface the per-project configuration that today only lives in `projects.yaml` / global Settings.

## Out of scope

This is the discoverability/IA of project settings — separate from the merge-train work. Filed so it isn't lost.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
