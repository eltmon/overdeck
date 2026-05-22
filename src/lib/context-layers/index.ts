/**
 * Layered context distribution (PAN-1201).
 *
 * Public surface of the context-layers subsystem: the harness templating
 * engine, layer path/IO helpers, bundled-rule rendering, layer rendering,
 * workspace assembly, and the one-shot devroot migration.
 */

export {
  type HarnessMarker,
  HARNESS_MARKERS,
  KNOWN_HARNESS_MARKERS,
  renderForHarness,
  validateTemplate,
  type TemplateIssue,
  type TemplateValidation,
} from './harness.js';

export {
  type ContextLayerKind,
  CONTEXT_LAYER_KINDS,
  type ContextLayer,
  globalContextDir,
  globalContextFile,
  globalSkillsDir,
  globalAgentsDir,
  projectContextDir,
  projectContextFile,
  workspaceContextDir,
  workspaceContextFile,
  GLOBAL_STARTER,
  PROJECT_STARTER,
  globalLayer,
  projectLayer,
  workspaceLayer,
  ensureGlobalLayer,
  ensureProjectLayer,
  readLayerContent,
} from './layers.js';

export {
  type RuleScope,
  type BundledRule,
  parseRule,
  readBundledRules,
  renderBundledRules,
} from './rules.js';

export {
  REGION_BEGIN,
  REGION_END,
  applyManagedRegion,
  renderGlobalLayer,
  renderProjectLayer,
} from './render.js';

export { type WorkspaceContextInput, assembleWorkspaceContext } from './assemble.js';

export {
  type DevrootMigrationResult,
  type DevrootMigrationOptions,
  discoverProjects,
  migrateDevroot,
} from './migrate.js';
