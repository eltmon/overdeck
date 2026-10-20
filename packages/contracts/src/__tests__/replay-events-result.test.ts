import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'

import { ReplayEventsResult } from '../rpc'

const decodeReplayEventsResult = Schema.decodeUnknownSync(ReplayEventsResult)
const encodeReplayEventsResult = Schema.encodeSync(ReplayEventsResult)

describe('ReplayEventsResult (PAN-4559)', () => {
  it('decodes an empty event array', () => {
    expect(decodeReplayEventsResult([])).toEqual([])
  })

  it('decodes { tooFarBehind: true }', () => {
    expect(decodeReplayEventsResult({ tooFarBehind: true })).toEqual({ tooFarBehind: true })
  })

  it('rejects { tooFarBehind: false }', () => {
    expect(() => decodeReplayEventsResult({ tooFarBehind: false })).toThrow()
  })

  it('encodes { tooFarBehind: true }', () => {
    expect(encodeReplayEventsResult({ tooFarBehind: true })).toEqual({ tooFarBehind: true })
  })
})
