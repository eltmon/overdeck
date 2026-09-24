/**
 * Internal entry; not a supported library API (PAN-3958 Q1).
 *
 * `package.json` points `main` here so the build has an entry, but nothing in
 * this repository imports `@overdeck/core` as a library and no documentation
 * describes library use. Names re-exported below may be removed in any release;
 * removals are listed in the release notes.
 */
export * from './lib/paths.js';
export * from './lib/config.js';
export * from './lib/shell.js';
export * from './lib/backup.js';
export * from './lib/sync.js';
export * from './lib/tracker/index.js';
export * from './lib/providers.js';
export * from './lib/settings.js';
export * from './lib/docs/corpus.js';
export * from './lib/docs/index-builder.js';
export * from './lib/docs/injection.js';
export * from './lib/docs/query.js';
export * from './lib/docs/state.js';
