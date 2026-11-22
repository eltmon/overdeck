import { describe, expect, it } from 'vitest'

import { getRuntime } from '../index.js'

describe('Antigravity runtime registration (PAN-5587)', () => {
  it('registers the antigravity ACP runtime in the global registry', () => {
    expect(getRuntime('antigravity')).toBeDefined()
    expect(getRuntime('antigravity')?.name).toBe('antigravity')
  })
})
