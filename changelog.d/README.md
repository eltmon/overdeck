# changelog.d

Each PR that changes something users notice adds one file here, `changelog.d/<issue>.md` (lowercase issue ID, for example `pan-5137.md`). Do not edit the top of `changelog.mdx`: one file per PR means concurrent PRs never conflict. If a second PR for the same issue is already open with its own `changelog.d/<issue>.md`, name yours `changelog.d/<issue>-<pr>.md` instead, so the two branches never add the same file.

`pan release stable` folds every file except this README into a dated `<Update>` block at the top of `changelog.mdx`, sections in the order New, Improved, Fixed, and deletes the files in the release commit.

Format:

    #### Fixed

    - **Short bold lead:** what changed for the user, in plain sentences. ([#5137](https://github.com/eltmon/overdeck/issues/5137))

- Headings are exactly `#### New`, `#### Improved` or `#### Fixed`, each used at most once, each with at least one bullet.
- A bullet starts with `- `. Indent continuation lines by two spaces.
- Write `&#36;` for a dollar sign and `&lt;` before a digit. `npm run lint:docs` checks all of this.
