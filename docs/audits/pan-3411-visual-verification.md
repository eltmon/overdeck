# PAN-3411 visual and keyboard verification

Verified on 2026-08-09 with Chromium 148 through Playwright 1.60.0, using an
isolated browser context against the feature workspace's Vite server. Stable
API fixtures supplied three registered projects, a git-backed shared target,
one existing main workspace, clean create-intent resolution, and an invalid-name
finding. No live dashboard state or operator browser profile was used.

## Screenshot evidence

The wide captures use a 1440 × 900 viewport. All seven page regions are visible
at once: project chip row, hero title, target row, upper hairline, status strip,
lower hairline, and idea grid.

- [Wide, clean resolution](../../images/dashboard/pan-3411-1440x900-clean.png)
- [Wide, finding present](../../images/dashboard/pan-3411-1440x900-finding.png)

The narrow captures use a 900 × 700 viewport. The page correctly becomes an
internal vertical scroller, so each state has a top and bottom capture. Together
they show all seven regions: the target controls wrap without overlap, the
status text wraps independently of the actions, and the idea grid becomes two
columns without clipping.

- [Narrow, clean resolution — top](../../images/dashboard/pan-3411-900x700-clean-top.png)
- [Narrow, clean resolution — bottom](../../images/dashboard/pan-3411-900x700-clean-bottom.png)
- [Narrow, finding present — top](../../images/dashboard/pan-3411-900x700-finding-top.png)
- [Narrow, finding present — bottom](../../images/dashboard/pan-3411-900x700-finding-bottom.png)

In both finding captures, `Workspace names cannot contain “/”.` appears inline
in the destructive foreground token and **Start workspace** is visibly disabled.
The finding does not displace or overlap the cancel and submit actions.

## Keyboard-only pass

The same isolated page passed this keyboard sequence without pointer input:

1. The hero title received autofocus and accepted the workspace name.
2. `Shift+Tab` reached a project chip; `Enter` selected it.
3. `Tab` reached the target picker; `Enter` opened and closed its registered-target menu.
4. `Tab` reached both mode buttons; `Enter` activated **Isolated worktree**.
5. `Tab` reached **Advanced**; `Enter` disclosed the parent-branch input, which accepted `main`.
6. `Tab` reached **Cancel** and then **Start workspace**. After the clean resolve,
   the submit action was enabled; `Enter` issued exactly one create request and
   exactly one activation request.

Result: **passed**. Every required control is keyboard reachable and operable,
and submission retains the single-create plus activation behavior.
