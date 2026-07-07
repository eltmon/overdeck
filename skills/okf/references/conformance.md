# OKF Conformance Gate

The gate is deterministic and scriptable. It decides whether a bundle is OKF-conformant; it does not judge prose quality.

## Exit Codes

| Exit | Meaning |
| --- | --- |
| 0 | No conformance errors. |
| 1 | Lint findings only, or strict mode promoted lint findings. |
| 2 | Conformance errors. |

## ERROR Codes

- `E_FRONTMATTER_PARSE`: a concept has no parseable YAML frontmatter block.
- `E_TYPE_MISSING`: a concept frontmatter block omits `type`.
- `E_TYPE_EMPTY`: a concept has `type` but the value is empty.
- `E_RESERVED_FRONTMATTER`: reserved `index.md` or `log.md` has frontmatter where it is not permitted.
- `E_RESERVED_AS_CONCEPT`: a reserved filename is treated as a concept document.

## LINT Codes

- `L_DESCRIPTION_MISSING`: a concept has no one-line `description`.
- `L_BROKEN_LINK`: a concept link points to a missing in-bundle target.
- `L_INDEX_STALE`: generated `index.md` content does not match concepts.
- `L_LOG_STALE`: generated `log.md` content is missing an expected entry.
- `L_CONCEPT_OVERSIZED`: a concept should be split for readability or embedding quality.
- `L_CITATION_MISSING`: body claims appear source-backed but no citation section exists.

## Diff-Lint Rule

`diff_lint.py` compares base and head. Pre-existing lint findings do not block. New conformance errors always block. New lint findings block only when the caller asks for strict behavior.
