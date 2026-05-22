import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/pan-test-specialist-harnesses-config',
  AGENTS_DIR: '/tmp/pan-test-specialist-harnesses-config/agents',
  CONFIG_DIR: '/tmp/pan-test-specialist-harnesses-config',
  HEARTBEATS_DIR: '/tmp/pan-test-specialist-harnesses-config/heartbeats',
  COSTS_DIR: '/tmp/pan-test-specialist-harnesses-config/costs',
  ARCHIVES_DIR: '/tmp/pan-test-specialist-harnesses-config/archives',
  BACKUPS_DIR: '/tmp/pan-test-specialist-harnesses-config/backups',
  BIN_DIR: '/tmp/pan-test-specialist-harnesses-config/bin',
  COMMANDS_DIR: '/tmp/pan-test-specialist-harnesses-config/commands',
  SKILLS_DIR: '/tmp/pan-test-specialist-harnesses-config/skills',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
  encodeClaudeProjectDir: (p: string) => p,
}))

const TEST_HOME = '/tmp/pan-test-specialist-harnesses-config'

import { loadCloisterConfigSync, saveCloisterConfigSync, type CloisterConfig } from '../config.js'

describe('cloister specialist_harnesses config (PAN-636)', () => {
  beforeEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true })
    mkdirSync(TEST_HOME, { recursive: true })
  })
  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true })
  })

  it('defaults specialist_harnesses to an empty block (every role => claude-code on read) (AC1, AC2)', () => {
    const cfg = loadCloisterConfigSync()
    expect(cfg.model_selection.specialist_harnesses).toBeDefined()
    expect(cfg.model_selection.specialist_harnesses).toEqual({})
  })

  it('round-trips specialist_harnesses through saveCloisterConfig + loadCloisterConfig (AC3)', () => {
    const cfg = loadCloisterConfigSync()
    const updated: CloisterConfig = {
      ...cfg,
      model_selection: {
        ...cfg.model_selection,
        specialist_harnesses: {
          review_agent: 'pi',
          test_agent: 'claude-code',
        },
      },
    }
    saveCloisterConfigSync(updated)
    const reloaded = loadCloisterConfigSync()
    expect(reloaded.model_selection.specialist_harnesses).toEqual({
      review_agent: 'pi',
      test_agent: 'claude-code',
    })
  })

  it('absent specialist_harnesses key in legacy config does not blow up (AC3 — no migration needed)', () => {
    // Write a TOML file that has model_selection but NO specialist_harnesses block.
    writeFileSync(
      join(TEST_HOME, 'cloister.toml'),
      `[model_selection]\ndefault_model = "sonnet"\n[model_selection.complexity_routing]\ntrivial = "haiku"\nsimple = "haiku"\nmedium = "sonnet"\ncomplex = "sonnet"\nexpert = "opus"\n`,
    )
    const cfg = loadCloisterConfigSync()
    expect(cfg.model_selection.default_model).toBe('sonnet')
    // Default fills in via deepMerge — the absent key turns into the default empty block.
    expect(cfg.model_selection.specialist_harnesses).toEqual({})
  })
})
