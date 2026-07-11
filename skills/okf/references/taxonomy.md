# Suggested Concept Taxonomy

OKF does not prescribe a fixed taxonomy. Use these types as consistent defaults, and preserve project-specific type names when converting existing bundles.

| Type | Use For |
| --- | --- |
| `Service` | A deployable service or long-running process. |
| `Module` | A source module, package, subsystem, or bounded context. |
| `API` | HTTP, RPC, CLI, event, or library contracts. |
| `Datastore` | Databases, tables, queues, indexes, object stores, or schemas. |
| `Runbook` | Operational procedures, debugging flows, incident response, or release steps. |
| `Decision` | Architecture decisions, rejected options, constraints, and rationale. |
| `Guide` | How-to documentation for a repeated workflow. |
| `Glossary` | Term definitions and domain vocabulary. |
| `Reference` | Stable facts, lookup tables, external references, and source mirrors. |
| `Policy` | Rules that agents or humans must follow. |

## Naming

- Prefer singular type names.
- Use a specific existing project term when it is clearer than a generic one.
- Keep one idea per concept. Split mixed concepts before adding more headings.
- Use tags for cross-cutting grouping; do not invent tag index files.

## Authoring

When `/okf author "<topic>"` creates a concept, infer the narrowest useful type from this taxonomy and confirm ambiguous choices before writing. New concepts should include `type`, `title`, `description`, `tags`, and `timestamp` when the information is available; unknown existing keys are preserved on updates.
