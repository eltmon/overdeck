# PAN-5191 browser UAT (banner.ac4, banner.ac5)

Run 2026-11-13 against this branch's build in the feature workspace's own server
container (`overdeck-feature-pan-5191-server-1`), in a fresh headless Chromium
context (Playwright, no shared profile), signed in with the container's internal
token as a local operator.

## Deviation: a fixture project stands in for the overdeck checkout

The container registers its own projects. `project:overdeck` there is a throwaway
repo (`.tmp/uat-5191/overdeck`, a `README.md` and a local bare `origin` holding
`main`, with `workspaces/` excluded as the real repo ignores it), not the real
overdeck checkout. Pointing the UAT at the real checkout would have run
`git fetch`, `worktree add` and `branch -D` in the shared primary repo. The fixture
has no `github_repo`, so no `gh` call could fire (D-F17); the Create PR dialog
therefore shows both support reasons.

The browser reached the server on `http://localhost:3013` (a trusted origin)
through a local TCP forward, because the frontend container's Vite dev server
fails to build CSS (`Cannot find module '@tailwindcss/typography'` in its
node_modules volume), an environment problem outside this change.

## banner.ac4

Typed `UAT line typed by the PAN-5191 browser check.` at the end of `README.md`
in a code pane on `project:overdeck` and waited past the 1 s autosave.

- The code pane note read "Edits here are saved to an edit workspace. The main
  checkout is never changed."
- `git -C <fixture> status --porcelain` printed nothing.
- `workspaces/scratch-edit-1114-0251` existed on branch `scratch/edit-1114-0251`,
  and its `git diff` added the typed line to `README.md`.
- The explorer banner read "Editing in edit workspace edit-1114-0251 (branch
  scratch/edit-1114-0251). The main checkout is not changed." with Create PR,
  Discard and New edit workspace (`03-edit-workspace-banner.png`).
- Create PR opened with the title `chore: edit README.md`; Open PR and Send
  through pipeline were disabled with "Create PR needs a GitHub repository: set
  github_repo for this project in projects.yaml." (`04-create-pr-dialog.png`).

## banner.ac5

Discard listed `README.md` under "These changes will be lost:". Confirming it:

- removed `workspaces/scratch-edit-1114-0251` (the `workspaces/` dir was empty);
- left no `scratch/edit-*` branch;
- left `git status --porcelain` of the fixture empty;
- returned the explorer to `overdeck` on `main`, with the toast "Discarded edit
  workspace edit-1114-0251." (`06-after-discard.png`).

Not exercised here (operator checks, D-F17): a real direct PR, merge, PR close
and send through pipeline against GitHub.
