/**
 * Project state-plane path authority.
 *
 * PAN-3165: the specs/drafts/continues directories had two derivations — this
 * one (state-branch aware) and a hardcoded `<projectRoot>/.pan/specs` inside
 * `xbrief/xbrief-index.ts`, which resolved to the pre-cutover in-repo location
 * and returned null for every spec written since PAN-2541. The resolution lives
 * here, in a leaf module, so both the sync and async spec resolvers can import
 * it without a cycle through `pan-dir/specs.ts`.
 */
import { join } from 'path'
import { findProjectByPathSync, type ProjectConfig } from '../projects.js'
import { resolveStateReadHomeSync } from '../state-read-home.js'
import {
  PAN_DIRNAME,
  PAN_CONTINUES_DIRNAME,
  PAN_DRAFTS_DIRNAME,
  PAN_SPECS_DIRNAME,
  type ProjectPanPaths,
} from './types.js'

export function getProjectPanPaths(projectRoot: string): ProjectPanPaths {
  const project: ProjectConfig = findProjectByPathSync(projectRoot) ?? {
    name: projectRoot,
    path: projectRoot,
  }
  const stateHome = resolveStateReadHomeSync(project)
  const panDir = stateHome.migrated ? stateHome.root : join(stateHome.root, PAN_DIRNAME)
  return {
    panDir,
    specsDir: join(panDir, PAN_SPECS_DIRNAME),
    draftsDir: join(panDir, PAN_DRAFTS_DIRNAME),
    continuesDir: join(panDir, PAN_CONTINUES_DIRNAME),
  }
}
