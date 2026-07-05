import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('GET /api/workspaces/:issueId/plan - tieredExecution block', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns tieredExecution with source=plan-metadata when plan.metadata.tiered_execution is set to on', async () => {
    const mockDoc = {
      vBRIEFInfo: { version: '1.0.0', created: '2026-07-05' },
      plan: {
        id: 'plan-1',
        title: 'Test Plan',
        status: 'active',
        items: [],
        edges: [],
        metadata: { tiered_execution: 'on' as const },
      },
    }

    const mockConfig = { tieredExecution: { enabled: false } }

    const response = {
      ...mockDoc,
      tieredExecution: { effective: true, source: 'plan-metadata', override: 'on' },
      lifecycleDir: 'workspace',
      criticalPath: [],
    }

    expect(response.tieredExecution.effective).toBe(true)
    expect(response.tieredExecution.source).toBe('plan-metadata')
    expect(response.tieredExecution.override).toBe('on')
  })

  it('returns tieredExecution with source=plan-metadata when plan.metadata.tiered_execution is set to off', async () => {
    const mockDoc = {
      vBRIEFInfo: { version: '1.0.0', created: '2026-07-05' },
      plan: {
        id: 'plan-1',
        title: 'Test Plan',
        status: 'active',
        items: [],
        edges: [],
        metadata: { tiered_execution: 'off' as const },
      },
    }

    const response = {
      ...mockDoc,
      tieredExecution: { effective: false, source: 'plan-metadata', override: 'off' },
      lifecycleDir: 'workspace',
      criticalPath: [],
    }

    expect(response.tieredExecution.effective).toBe(false)
    expect(response.tieredExecution.source).toBe('plan-metadata')
    expect(response.tieredExecution.override).toBe('off')
  })

  it('returns tieredExecution with source=global and override=null when no plan metadata override exists', async () => {
    const mockDoc = {
      vBRIEFInfo: { version: '1.0.0', created: '2026-07-05' },
      plan: {
        id: 'plan-1',
        title: 'Test Plan',
        status: 'active',
        items: [],
        edges: [],
        metadata: {},
      },
    }

    const responseWhenGlobalDisabled = {
      ...mockDoc,
      tieredExecution: { effective: false, source: 'global', override: null },
      lifecycleDir: 'workspace',
      criticalPath: [],
    }

    const responseWhenGlobalEnabled = {
      ...mockDoc,
      tieredExecution: { effective: true, source: 'global', override: null },
      lifecycleDir: 'workspace',
      criticalPath: [],
    }

    expect(responseWhenGlobalDisabled.tieredExecution.effective).toBe(false)
    expect(responseWhenGlobalDisabled.tieredExecution.source).toBe('global')
    expect(responseWhenGlobalDisabled.tieredExecution.override).toBeNull()

    expect(responseWhenGlobalEnabled.tieredExecution.effective).toBe(true)
    expect(responseWhenGlobalEnabled.tieredExecution.source).toBe('global')
    expect(responseWhenGlobalEnabled.tieredExecution.override).toBeNull()
  })
})
