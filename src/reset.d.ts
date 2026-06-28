// Adopt only the safe, low-blast-radius ts-reset rules (A2). Aggressive rules
// (json-parse, fetch, …) are deferred — see docs/codebase-health/A2-ts-reset.md.
import '@total-typescript/ts-reset/filter-boolean';
import '@total-typescript/ts-reset/array-includes';
