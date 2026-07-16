# Conversion Guidance

Convert source material into OKF conservatively. Existing documents are source evidence, not disposable drafts.

## General Rules

- Start with a dry-run plan that lists proposed concept IDs, types, and source files.
- Add frontmatter before any rename.
- Apply renames only after explicit confirmation from the user.
- Never delete or rename a README or source document during conversion.
- Preserve existing citations and outbound links.
- Prefer bundle-root links (`/path/to/concept.md`) for durable cross-links.
- Record uncertain mappings in the PR description instead of guessing silently.
- After confirmed edits, regenerate indexes and logs with `reindex.py`, then run `validate.py --strict`.

## Loose Markdown

- One source heading may become one concept when it describes one idea.
- Split large documents by stable domain boundaries, not by arbitrary token limits.
- If a document is already canonical user documentation, create a `Reference` or `Guide` concept that cites it rather than replacing it.

## Obsidian

- Convert wiki links to Markdown links.
- Preserve aliases as prose or tags only when they carry useful meaning.
- Do not copy local vault plugin metadata unless it helps future agents.

## Notion Exports

- Normalize generated filenames into stable kebab-case concept IDs.
- Preserve exported assets as citations or resources.
- Remove presentation-only blocks when they do not carry knowledge.

## CSV Or Tables

- Treat schema-like tables as `Datastore`, `Reference`, or `Glossary` concepts depending on their role.
- Preserve row provenance and source paths in citations.
