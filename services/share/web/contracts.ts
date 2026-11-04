/**
 * `@overdeck/contracts` for the hosted viewer bundle (PRD PAN-4481 D-8).
 *
 * The full package index pulls in `effect`. The viewer needs only the sharing types and the
 * data-channel wire helpers, and both of these modules are free of runtime dependencies, so the
 * bundle and the viewer tsconfig alias the package name to this file.
 */
export * from '../../../packages/contracts/src/sharing.ts';
export * from '../../../packages/contracts/src/sharing-wire.ts';
