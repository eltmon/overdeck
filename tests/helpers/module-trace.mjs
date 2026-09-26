// Preload (`node --import <this file> …`) that records every ESM module the
// process loads, one URL per line, into the file named by PAN_MODULE_TRACE.
// Built-ins (`node:*`) are skipped. With PAN_MODULE_TRACE_PARENTS set, each
// line is `<parent URL> -> <URL>` instead, to show who pulled a module in.
// Used by the CLI startup guard (PAN-4195).
import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const out = process.env.PAN_MODULE_TRACE;
const withParents = Boolean(process.env.PAN_MODULE_TRACE_PARENTS);
if (out) {
  const seen = new Set();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!resolved.url.startsWith('node:') && !seen.has(resolved.url)) {
        seen.add(resolved.url);
        appendFileSync(out, withParents ? `${context.parentURL ?? '(entry)'} -> ${resolved.url}\n` : `${resolved.url}\n`);
      }
      return resolved;
    },
  });
}
