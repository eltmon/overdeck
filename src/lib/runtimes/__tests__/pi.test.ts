import { describe, expect, it } from 'vitest'

import { PiSpawnTimeout } from '../pi.js'

// The Pi runtime adapter classes (sync and Effect) and their tests were deleted in
// PAN-3958 (#4007): nothing constructed them after PAN-1989. PiSpawnTimeout survives.
describe('PiSpawnTimeout', () => {
  // PiSpawnTimeout is a typed error class — verify it is exported and
  // constructible so consumers can `instanceof` against it.
  it('PiSpawnTimeout is an exported error class with a typed code', () => {
    const err = new PiSpawnTimeout('agent-x')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('PI_SPAWN_TIMEOUT')
    expect(err.message).toMatch(/agent-x/)
  })
})
