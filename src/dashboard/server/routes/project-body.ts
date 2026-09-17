/**
 * Shared JSON body reader for the project routes.
 *
 * This lives apart from `projects.ts` to keep the dependency graph acyclic.
 * `projects.ts` merges the layer exported by `project-create-routes.ts`, so if
 * that module also imported the body reader *from* `projects.ts` the two would
 * import each other — a real cycle, and one the circular-dependency guard
 * correctly refuses to baseline (PAN-3836).
 *
 * A malformed or absent body yields `{}` rather than throwing: every caller
 * narrows the fields it needs with `typeof` checks anyway, so a parse failure
 * should surface as a field validation error, not a 500.
 */

import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';

export const readProjectJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});
